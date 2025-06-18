/** @odoo-module **/

import { registerModel, registerPatch } from '@mail/model/model_core';
import { attr, many, one } from '@mail/model/model_field';
import { useService } from "@web/core/utils/hooks";


window.messageToggleComments = function(messageId) {
    console.log("Global messageToggleComments called for message:", messageId);
    try {
        // Prevent infinite loop by checking if already processing
        if (window._processingMessageToggle) {
            console.log("Already processing, skipping to prevent infinite loop");
            return;
        }
        window._processingMessageToggle = true;
        
        // Try to find the comment model directly from messaging system
        if (typeof odoo !== 'undefined' && odoo.__DEBUG__ && odoo.__DEBUG__.services) {
            try {
                const messaging = odoo.__DEBUG__.services['@mail/model/model_manager'].messaging;
                if (messaging && messaging.models && messaging.models.MessageActivityCommentModel) {
                    const commentModels = messaging.models.MessageActivityCommentModel.all();
                    const targetModel = commentModels.find(model => model.message && model.message.id == messageId);
                    if (targetModel) {
                        console.log("Found comment model, calling toggleComments directly");
                        targetModel.toggleComments();
                        return;
                    }
                }
            } catch (messagingError) {
                console.log("Could not access messaging system:", messagingError);
            }
        }
        
        // Fallback: trigger without infinite loop
        console.log("Using fallback method for message:", messageId);
        
    } catch (error) {
        console.error("Error in global messageToggleComments:", error);
    } finally {
        // Reset the flag after processing
        setTimeout(() => {
            window._processingMessageToggle = false;
        }, 100);
    }
};

// Global fallback function for messages
window.messageSubmitComment = function() {
    console.log("Global messageSubmitComment called");
    try {
        // Find the active textarea and get its value
        const activeTextarea = document.querySelector('[data-message-id] textarea:focus') || 
                              document.querySelector('[data-message-id] textarea');
        if (activeTextarea && activeTextarea.value.trim()) {
            const commentText = activeTextarea.value.trim();
            console.log("Global submit with text:", commentText);
            
            // Create a simple message display
            const messageId = activeTextarea.closest('[data-message-id]').getAttribute('data-message-id');
            let commentPanel = document.querySelector(`[data-message-id="${messageId}"] [t-ref="commentPanel"]`);
            
            if (!commentPanel) {
                commentPanel = document.querySelector(`[data-message-id="${messageId}"] .border.rounded-3.bg-view`);
            }
            
            if (commentPanel) {
                // Create message HTML
                const messageHtml = `
                    <div class="o_simple_message d-flex mb-3">
                        <img class="me-2 rounded-circle" src="/web/image?model=res.users&field=avatar_128&id=2" 
                             alt="Avatar" style="width: 32px; height: 32px;"/>
                        <div class="flex-grow-1">
                            <div class="d-flex align-items-center mb-1">
                                <strong class="text-dark">Current User</strong>
                                <small class="text-muted ms-2">${new Date().toLocaleString()}</small>
                            </div>
                            <div class="text-dark">${commentText}</div>
                        </div>
                    </div>
                `;
                
                // Find or create thread container
                let threadContainer = commentPanel.querySelector('.o_simple_thread');
                if (!threadContainer) {
                    threadContainer = document.createElement('div');
                    threadContainer.className = 'o_simple_thread p-3 border-bottom';
                    commentPanel.insertBefore(threadContainer, commentPanel.firstChild);
                }
                
                // Add message
                threadContainer.insertAdjacentHTML('beforeend', messageHtml);
                
                // Clear textarea
                activeTextarea.value = '';
                
                // Scroll to bottom
                commentPanel.scrollTop = commentPanel.scrollHeight;
                
                console.log("Comment posted successfully (global)!");
            }
        } else {
            console.log("Please enter a comment before sending.");
        }
    } catch (error) {
        console.error("Global submit error:", error);
        console.error("Error posting comment: " + error.message);
    }
};

registerModel({
    name: 'MessageActivityCommentModel',
    recordMethods: {
        /**
         * Initialize the model and load saved state
         */
        _created() {
            if (this.message && this.message.id) {
                // Load comment count immediately on creation
                this._loadCommentCount();
                // Load comment count from database immediately
                this._loadCommentCountFromDatabase();
                // Set up initial state
                setTimeout(() => {
                    this._loadThreadState();
                }, 50);
                // Also load count after a short delay to catch late-rendered elements
                setTimeout(() => {
                    this._loadCommentCountFromDatabase();
                }, 500);
                // And one more time to be sure
                setTimeout(() => {
                    this._loadCommentCountFromDatabase();
                }, 1000);
            }
        },
        toggleComments() {
            try {
                console.log("Message toggleComments called, current showComments:", this.showComments);
                const newState = !this.showComments;
                this.update({ showComments: newState });
                if (!newState) {
                    // Hiding comments - reset composer
                    console.log("Message hiding comments");
                    this.update({ needsComposer: false });
                } else {
                    // Showing comments - show composer and load messages from database
                    console.log("Message showing comments");
                    this.update({ needsComposer: true });
                    
                    // Check if we already have thread and messages loaded
                    if (this.thread && this.thread.id) {
                        console.log("Message thread already exists, loading messages for thread:", this.thread.id);
                        // Just reload messages for existing thread
                        setTimeout(() => {
                            this._loadThreadMessages(this.thread.id);
                        }, 50); // Faster DOM ready check
                    } else {
                        console.log("No message thread exists, creating new thread");
                        // Load existing messages from database
                        this.preloadThread();
                    }
                    
                    // Setup message listener when first showing comments
                    this._setupMessageListener();
                }
                console.log("Message toggleComments completed, new showComments:", this.showComments);
            } catch (e) { console.error("Error in toggleComments:", e); }
        },
        async preloadThread() {
            if (this.thread) return Promise.resolve(this.thread);
            
            try {
                // Get or create activity thread using RPC
                const rpc = this.messaging.rpc || this.env.services.rpc;
                const threadData = await rpc({
                    model: 'mail.activity.thread',
                    method: 'search_read',
                    args: [[['activity_done_message_id', '=', this.message.id]]],
                    kwargs: {
                        fields: ['id', 'name', 'activity_done_message_id'],
                        limit: 1
                    }
                });
                
                let threadId;
                if (threadData && threadData.length > 0) {
                    threadId = threadData[0].id;
                } else {
                    // Create new thread for this message
                    threadId = await rpc({
                        model: 'mail.activity.thread',
                        method: 'create',
                        args: [[{
                            'activity_done_message_id': this.message.id,
                            'name': `Comments for ${this.message.subject || 'Activity'}`,
                            'res_model': this.message.model,
                            'res_id': this.message.res_id,
                        }]]
                    });
                }
                
                // Create thread object with real ID
                const thread = this.messaging.models['Thread'].insert({
                    id: threadId,
                    model: 'mail.activity.thread',
                    name: `Comments for ${this.message.subject || 'Activity'}`,
                });
                
                this.update({ thread: thread });
                
                // Load existing messages for this thread
                await this._loadThreadMessages(threadId);
                
                return Promise.resolve(thread);
            } catch (error) {
                console.error("Error in preloadThread:", error);
                return Promise.resolve(null);
            }
        },
        async _loadThreadMessages(threadId) {
            try {
                console.log("Loading message thread messages for threadId:", threadId);
                const rpc = this.messaging.rpc || this.env.services.rpc;
                const messages = await rpc({
                    model: 'mail.message',
                    method: 'search_read',
                    args: [[['res_id', '=', threadId], ['model', '=', 'mail.activity.thread']]],
                    kwargs: {
                        fields: ['id', 'body', 'author_id', 'date', 'subject'],
                        order: 'date asc'
                    }
                });
                
                console.log("Found message thread messages from server:", messages ? messages.length : 0);
                
                if (messages && messages.length > 0) {
                    // Immediate render with fallback
                    this._renderMessagesToDOM(messages);
                    
                    // Fallback render if first attempt fails
                    setTimeout(() => {
                        const commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] [t-ref="commentPanel"]`);
                        if (commentPanel) {
                            const existingMessages = commentPanel.querySelectorAll('.o_simple_message');
                            if (existingMessages.length === 0) {
                                console.log("Message fallback render needed");
                                this._renderMessagesToDOM(messages);
                            }
                        }
                    }, 100);
                    
                    // Update comment count manually
                    this.update({ commentCount: messages.length });
                } else {
                    console.log("No messages found for message threadId:", threadId, "- thread might be empty");
                    // Even if no messages, ensure we have a thread container for new messages
                    const commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] [t-ref="commentPanel"]`);
                    if (commentPanel) {
                        let threadContainer = commentPanel.querySelector('.o_simple_thread');
                        if (!threadContainer) {
                            threadContainer = document.createElement('div');
                            threadContainer.className = 'o_simple_thread p-3 border-bottom';
                            threadContainer.innerHTML = '<p class="text-muted text-center p-2">No comments yet. Be the first to comment!</p>';
                            commentPanel.insertBefore(threadContainer, commentPanel.firstChild);
                            console.log("Created empty message thread container with placeholder");
                        }
                    }
                }
            } catch (error) {
                console.error("Error loading message thread messages:", error);
                // Create empty thread container even on error
                const commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] [t-ref="commentPanel"]`);
                if (commentPanel && !commentPanel.querySelector('.o_simple_thread')) {
                    const threadContainer = document.createElement('div');
                    threadContainer.className = 'o_simple_thread p-3 border-bottom';
                    threadContainer.innerHTML = '<p class="text-muted text-center p-2">No comments yet. Be the first to comment!</p>';
                    commentPanel.insertBefore(threadContainer, commentPanel.firstChild);
                    console.log("Created fallback message thread container due to error");
                }
            }
        },
        _renderMessagesToDOM(messages) {
            try {
                console.log("Message _renderMessagesToDOM called with", messages.length, "messages");
                
                // Try multiple selectors to find comment panel
                let commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] [t-ref="commentPanel"]`);
                
                if (!commentPanel) {
                    commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] .border.rounded-3.bg-view`);
                }
                
                if (!commentPanel) {
                    // Try to find any visible comment panel for this message
                    const allPanels = document.querySelectorAll('.border.rounded-3.bg-view');
                    for (let panel of allPanels) {
                        const messageWrapper = panel.closest('[data-message-id]');
                        if (messageWrapper && messageWrapper.getAttribute('data-message-id') == this.message.id) {
                            commentPanel = panel;
                            break;
                        }
                    }
                }
                
                console.log("Found message comment panel:", commentPanel);
                
                if (commentPanel) {
                    let threadContainer = commentPanel.querySelector('.o_simple_thread');
                    if (!threadContainer) {
                        threadContainer = document.createElement('div');
                        threadContainer.className = 'o_simple_thread p-3 border-bottom';
                        commentPanel.insertBefore(threadContainer, commentPanel.firstChild);
                        console.log("Created new message thread container for messages");
                    }
                    
                    // Clear existing messages
                    threadContainer.innerHTML = '';
                    
                    // Add each message
                    messages.forEach(msg => {
                        const authorName = msg.author_id && msg.author_id[1] ? msg.author_id[1] : 'Unknown User';
                        const messageDate = new Date(msg.date).toLocaleString();
                        const messageBody = msg.body || 'No content';
                        
                        const messageHtml = `
                            <div class="o_simple_message d-flex mb-3">
                                <img class="me-2 rounded-circle" src="/web/image?model=res.users&field=avatar_128&id=${msg.author_id ? msg.author_id[0] : 2}" 
                                     alt="Avatar" style="width: 32px; height: 32px;"/>
                                <div class="flex-grow-1">
                                    <div class="d-flex align-items-center mb-1">
                                        <strong class="text-dark">${authorName}</strong>
                                        <small class="text-muted ms-2">${messageDate}</small>
                                    </div>
                                    <div class="text-dark">${messageBody}</div>
                                </div>
                            </div>
                        `;
                        threadContainer.insertAdjacentHTML('beforeend', messageHtml);
                    });
                    
                    console.log("Successfully added", messages.length, "messages to message thread container");
                    
                    // Immediate scroll to bottom
                    commentPanel.scrollTop = commentPanel.scrollHeight;
                    
                } else {
                    console.error("Could not find message comment panel for message:", this.message.id);
                    // Quick retry
                    setTimeout(() => {
                        console.log("Quick retry to render message comments...");
                        this._renderMessagesToDOM(messages);
                    }, 100);
                }
            } catch (error) {
                console.error("Error rendering message comments to DOM:", error);
            }
        },
        getToggleText() {
            try {
                console.log("Message getToggleText called - showComments:", this.showComments, "commentCount:", this.commentCount);
                if (this.showComments) {
                    return this.env._t(" Hide Comments");
                } else if (this.commentCount > 0) {
                    return this.env._t(" See Comments") + ` (${this.commentCount})`;
                } else {
                    return this.env._t(" Add a Comment");
                }
            } catch (e) { console.error("Error in getToggleText:", e); return " Comments"; }
        },
        _updateCommentCount() {
            try {
                // Count messages from DOM instead of thread.messages
                const commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] [t-ref="commentPanel"]`);
                if (commentPanel) {
                    const messageElements = commentPanel.querySelectorAll('.o_simple_message');
                    const count = messageElements.length;
                    this.update({ commentCount: count });
                    // Save count to localStorage to persist across reloads
                    this._saveCommentCount(count);
                }
            } catch (e) { console.error("Error in _updateCommentCount:", e); }
        },
        onAttachmentCreated(attachment) {
            try {
                const currentAttachments = this.attachments || [];
                this.update({ attachments: [...currentAttachments, attachment] });
            } catch (error) { console.error("Error in onAttachmentCreated:", error); }
        },
        removeAttachment(attachmentId) {
            try {
                const currentAttachments = this.attachments || [];
                this.update({ attachments: currentAttachments.filter(att => att.id !== attachmentId) });
            } catch (error) { console.error("Error in removeAttachment:", error); }
        },
        canPostMessage() {
            try {
                const hasCommentText = this.commentText && this.commentText.trim() !== '';
                const hasAttachments = this.attachments && this.attachments.length > 0;
                return hasCommentText || hasAttachments;
            } catch (error) { console.error("Error in message canPostMessage:", error); return false; }
        },
        _checkSessionStorage() {
            try {
                const storedInfo = sessionStorage.getItem('open_activity_comments');
                if (storedInfo) {
                    const threadInfo = JSON.parse(storedInfo);
                    if (threadInfo &&
                        threadInfo.threadModel === 'mail.activity.thread' &&
                        threadInfo.activityDoneMessageId &&
                        threadInfo.activityDoneMessageId === this.message.id) {
                        if (!this.showComments) {
                            this.update({ showComments: true });
                        }
                        this._scrollIntoView();
                        sessionStorage.removeItem('open_activity_comments');
                    }
                }
            } catch (error) { console.error("Error checking session storage:", error); }
        },
        _setupMessageListener() {
            try {
                // Listen for new messages in the thread (if supported)
                if (this.thread && typeof this.thread.on === 'function') {
                    this.thread.on('message_posted', this, this._onMessagePosted);
                    this.thread.on('message_updated', this, this._onMessageUpdated);
                }
                
                // Listen for message updates (for done activity messages, if supported)
                if (this.message && typeof this.message.on === 'function') {
                    this.message.on('message_updated', this, this._onParentMessageUpdated);
                }
                
                // Setup session storage check on initialization
                this._checkSessionStorage();
                
                // Only load thread state if not already showing comments (to avoid overriding current state)
                if (!this.showComments) {
                    this._loadThreadState();
                }
            } catch (error) {
                console.error("Error setting up message listener:", error);
            }
        },
        _onMessagePosted(message) {
            try {
                // Update comment count when new message is posted
                this._updateCommentCount();
                
                // Scroll to show the new message
                setTimeout(() => {
                    const commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] [t-ref="commentPanel"]`);
                    if (commentPanel) {
                        commentPanel.scrollTop = commentPanel.scrollHeight;
                    }
                }, 100);
            } catch (error) {
                console.error("Error handling message posted:", error);
            }
        },
        _onMessageUpdated(message) {
            try {
                // Update comment count when message is updated
                this._updateCommentCount();
            } catch (error) {
                console.error("Error handling message updated:", error);
            }
        },
        _onParentMessageUpdated() {
            try {
                // Refresh the display when parent message is updated
                this.update({});
            } catch (error) {
                console.error("Error handling parent message updated:", error);
            }
        },
        _scrollIntoView() {
            try {
                if (this.message && this.message.id) {
                    setTimeout(() => {
                        const allMessages = document.querySelectorAll('.o_Message_content');
                        for (const msg of allMessages) {
                            if (msg.textContent.includes(this.message.body) ||
                                msg.innerHTML.includes(this.message.body)) {
                                msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                return;
                            }
                        }
                        const commentPanel = document.querySelector('.o_activity_comments_container');
                        if (commentPanel) {
                            commentPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    }, 100);
                }
            } catch (error) { console.error("Error scrolling message into view:", error); }
        },
        onClickTextarea() {
            try {
                const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                if (textarea) {
                    this.update({
                        textInputCursorStart: textarea.selectionStart,
                        textInputCursorEnd: textarea.selectionEnd
                    });
                }
            } catch (error) { console.error("Error in onClickTextarea:", error); }
        },
        onFocusTextarea() {
            this.update({ isFocused: true });
        },
        onKeydownTextarea(ev) {
            try {
                if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
                    ev.preventDefault();
                    this.submitComment();
                    return;
                }
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    this.toggleComments();
                    return;
                }
            } catch (error) { console.error("Error in onKeydownTextarea:", error); }
        },
        onKeyupTextarea(ev) {
            try {
                const textarea = ev.target;
                if (textarea) {
                    this.update({
                        textInputCursorStart: textarea.selectionStart,
                        textInputCursorEnd: textarea.selectionEnd
                    });
                }
            } catch (error) { console.error("Error in onKeyupTextarea:", error); }
        },
        async submitComment() {
            try {
                console.log("Message submitComment called");
                
                // First, sync the model with current textarea value
                const textarea = document.querySelector(`[data-message-id="${this.message.id}"] textarea`);
                if (textarea && textarea.value) {
                    this.update({ commentText: textarea.value });
                    console.log("Synced model with textarea value:", textarea.value);
                }
                
                // Get textarea value directly from DOM as fallback
                let commentText = this.commentText;
                if (!commentText || !commentText.trim()) {
                    // Try to get value from DOM directly
                    if (textarea && textarea.value) {
                        commentText = textarea.value.trim();
                        console.log("Got text from DOM:", commentText);
                    }
                }
                
                console.log("Final commentText:", commentText);
                
                if (!commentText || !commentText.trim()) {
                    console.log("No comment text found, returning");
                    console.log("Please enter a comment before sending.");
                    return;
                }
                
                // Update the model with the actual text
                this.update({ commentText: commentText });
                
                console.log("Saving message comment to database...");
                
                // Save comment to database via thread's message_post
                try {
                    // First ensure thread exists
                    await this.preloadThread();
                    
                    if (this.thread && this.thread.id) {
                        console.log("Posting message comment to thread ID:", this.thread.id);
                        
                        // Use thread's message_post to save to database
                        const rpc = this.messaging.rpc || this.env.services.rpc;
                        const messageData = await rpc({
                            model: 'mail.activity.thread',
                            method: 'message_post',
                            args: [this.thread.id],
                            kwargs: {
                                body: commentText,
                                message_type: 'comment',
                                subtype_xmlid: 'mail.mt_note'
                            }
                        });
                        
                        console.log("Message comment saved to database, message ID:", messageData);
                        
                        // Reload thread messages from database to update UI
                        await this._loadThreadMessages(this.thread.id);
                        
                        // Clear input after successful save
                        this.update({ commentText: '' });
                        
                        // Clear DOM textarea
                        const textarea = document.querySelector(`[data-message-id="${this.message.id}"] textarea`);
                        if (textarea) {
                            textarea.value = '';
                        }
                        
                        console.log("Message comment posted successfully to database!");
                        
                    } else {
                        console.error("No thread available for message:", this.message.id);
                        alert("Error: Could not create thread for comments");
                    }
                    
                } catch (error) {
                    console.error("Error saving message comment to database:", error);
                    alert("Error saving comment: " + error.message);
                }
                
            } catch (error) {
                console.error("Error in submitComment:", error);
                console.error("Error posting comment: " + error.message);   
            }
        },
        toggleEmoji(event) {
            // Placeholder for emoji functionality
            console.log("Emoji picker not implemented yet");
        },
        insertEmoji(emoji) {
            // Placeholder for emoji insertion
            console.log("Emoji insertion not implemented yet");
        },
        async uploadFile() {
            // Placeholder for file upload
            console.log("File upload not implemented yet");
        },
        async retryLocalMessages() {
            // Placeholder for retry functionality
            console.log("Retry messages not implemented yet");
        },
        _saveThreadState() {
            try {
                const threadState = {
                    messageId: this.message.id,
                    threadId: this.thread ? this.thread.id : null,
                    commentCount: this.commentCount,
                    showComments: this.showComments,
                    timestamp: Date.now()
                };
                localStorage.setItem(`message_thread_${this.message.id}`, JSON.stringify(threadState));
            } catch (error) {
                console.error("Error saving message thread state:", error);
            }
        },
        _loadThreadState() {
            try {
                const savedState = localStorage.getItem(`message_thread_${this.message.id}`);
                if (savedState) {
                    const threadState = JSON.parse(savedState);
                    // Only load if saved within last 24 hours
                    if (Date.now() - threadState.timestamp < 24 * 60 * 60 * 1000) {
                        // Only update commentCount, don't override showComments if it's already set
                        const updateData = { 
                            commentCount: threadState.commentCount || 0
                        };
                        
                        // Only set showComments to false if it's not already true
                        if (!this.showComments) {
                            updateData.showComments = false;
                        }
                        
                        this.update(updateData);
                        // Restore thread messages from DOM if they exist
                        this._restoreThreadMessages();
                    }
                }
            } catch (error) {
                console.error("Error loading message thread state:", error);
            }
        },
        _saveCommentCount(count) {
            try {
                localStorage.setItem(`message_comments_${this.message.id}`, count.toString());
            } catch (error) {
                console.error("Error saving message comment count:", error);
            }
        },
        _loadCommentCount() {
            try {
                const savedCount = localStorage.getItem(`message_comments_${this.message.id}`);
                if (savedCount) {
                    this.update({ commentCount: parseInt(savedCount) || 0 });
                }
            } catch (error) {
                console.error("Error loading message comment count:", error);
            }
        },
        async _loadCommentCountFromDatabase() {
            try {
                console.log("Loading comment count from database for message:", this.message.id);
                const rpc = this.messaging.rpc || this.env.services.rpc;
                
                // First check if thread exists for this message
                const threadData = await rpc({
                    model: 'mail.activity.thread',
                    method: 'search_read',
                    args: [[['activity_done_message_id', '=', this.message.id]]],
                    kwargs: {
                        fields: ['id'],
                        limit: 1
                    }
                });
                
                if (threadData && threadData.length > 0) {
                    const threadId = threadData[0].id;
                    
                    // Count messages in this thread
                    const messageCount = await rpc({
                        model: 'mail.message',
                        method: 'search_count',
                        args: [[['res_id', '=', threadId], ['model', '=', 'mail.activity.thread']]]
                    });
                    
                    console.log("Found", messageCount, "comments in database for message:", this.message.id);
                    
                    // Update comment count
                    this.update({ commentCount: messageCount });
                    // Save to localStorage for faster future loads
                    this._saveCommentCount(messageCount);
                    
                    console.log("Updated message", this.message.id, "comment count to:", messageCount);
                    
                    // Force UI update to show the new count
                    setTimeout(() => {
                        if (window.forceUIUpdate) {
                            window.forceUIUpdate();
                        }
                    }, 50);
                } else {
                    console.log("No thread found for message:", this.message.id, "- setting count to 0");
                    this.update({ commentCount: 0 });
                }
            } catch (error) {
                console.error("Error loading comment count from database:", error);
                // Fallback to localStorage count if database fails
                this._loadCommentCount();
            }
        },
        _restoreThreadMessages() {
            try {
                // Check if messages are already in DOM
                const commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] [t-ref="commentPanel"]`);
                if (commentPanel) {
                    const messageElements = commentPanel.querySelectorAll('.o_simple_message');
                    if (messageElements.length > 0) {
                        this.update({ commentCount: messageElements.length });
                        return;
                    }
                }
                // If no messages in DOM, try to reload from server
                this.preloadThread();
            } catch (error) {
                console.error("Error restoring message thread messages:", error);
            }
        },
        _triggerRerender() {
            try {
                // Simple rerender without causing loops
                console.log("Triggering rerender for message:", this.message.id, "with count:", this.commentCount);
                // Just update the model to trigger reactive updates
                this.update({});
            } catch (error) {
                console.error("Error triggering rerender:", error);
            }
        },

    },
    fields: {
        message: one('Message', {
            identifying: true,
            inverse: 'commentModel',
        }),
        showComments: attr({ default: false }),
        commentCount: attr({ 
            default: 0
        }),
        thread: one('Thread'),
        composerView: one('ComposerView'),
        needsComposer: attr({ default: false }),
        commentText: attr({ default: '' }),
        isFocused: attr({ default: false }),
        textInputCursorStart: attr({ default: 0 }),
        textInputCursorEnd: attr({ default: 0 }),
        attachments: many('Attachment'),
        hasAttachments: attr({
            compute() { return Boolean(this.attachments && this.attachments.length > 0); },
            default: false,
        }),
        hasLocalOnlyMessages: attr({ default: false }),
        pendingMessageCount: attr({
            compute() {
                if (!this.thread || !this.thread.messages) return 0;
                return this.thread.messages.filter(msg => msg.isLocalOnly).length;
            },
            default: 0,
        }),
    },
});

registerPatch({
    name: 'Message',
    fields: {
        commentModel: one('MessageActivityCommentModel', {
            inverse: 'message',
            isCausal: true,
        }),
    },
});

registerPatch({
    name: 'MessageView',
    recordMethods: {
        _created() {
            // Call parent _created if it exists
            if (this._super) {
                this._super();
            }
            // Ensure comment model is created and loaded for done activity messages
            if (this.message && this.message.id && this.message.model && 
                (this.message.model.includes('mail.activity') || 
                 (this.message.body && (
                   this.message.body.includes('To Do done') || 
                   this.message.body.includes('done') || 
                   this.message.body.includes('completed') ||
                   this.message.body.includes('To Do') ||
                   this.message.body.includes('marked as done')
                 )))) {
                setTimeout(() => {
                    this._ensureCommentModel();
                }, 100);
            }
        },
        _ensureCommentModel() {
            try {
                if (!this.message.commentModel) {
                    const commentModel = this.messaging.models['MessageActivityCommentModel'].insert({
                        message: this.message,
                    });
                    console.log("Auto-created comment model for message:", this.message.id);
                    // Load comment count immediately
                    setTimeout(() => {
                        if (this.message.commentModel) {
                            this.message.commentModel._loadCommentCountFromDatabase();
                        }
                    }, 50);
                } else {
                    // Model already exists, just load count
                    this.message.commentModel._loadCommentCountFromDatabase();
                }
            } catch (error) {
                console.error("Error ensuring message comment model:", error);
            }
        },
        toggleComments() {
            try {
                // Ensure commentModel exists
                if (!this.message.commentModel) {
                    try {
                        // Create the comment model explicitly
                        const commentModel = this.messaging.models['MessageActivityCommentModel'].insert({
                            message: this.message,
                        });
                        console.log("Created comment model for message:", this.message.id);
                        
                        // Give a moment for the causal relationship to link
                        setTimeout(() => {
                            if (this.message.commentModel) {
                                this.message.commentModel.toggleComments();
                            } else {
                                console.warn("Comment model still not linked after creation");
                            }
                        }, 10);
                        return;
                    } catch (modelError) {
                        console.error("Error creating comment model:", modelError);
                        return;
                    }
                }
                
                if (this.message.commentModel) {
                    this.message.commentModel.toggleComments();
                } else {
                    console.warn("Could not create comment model for message");
                }
            } catch (error) {
                console.error("Error in MessageView.toggleComments:", error);
            }
        },

    },
}); 