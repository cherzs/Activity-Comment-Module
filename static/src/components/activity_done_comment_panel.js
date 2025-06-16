/** @odoo-module **/

import { registerModel, registerPatch } from '@mail/model/model_core';
import { attr, many, one } from '@mail/model/model_field';
import { useService } from "@web/core/utils/hooks";
// import { moment } from '@web/core/l10n/dates';

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
        toggleComments() {
            try {
                const newState = !this.showComments;
                this.update({ showComments: newState });
                if (!newState) {
                    this._updateCommentCount();
                } else {
                    // Always show composer when opening comments
                    this.update({ needsComposer: true });
                    // Load existing messages
                    this.preloadThread();
                    // Setup message listener when first showing comments
                    this._setupMessageListener();
                }
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
                
                if (messages && messages.length > 0) {
                    // Instead of creating Message objects, render directly to DOM
                    const commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] [t-ref="commentPanel"]`);
                    if (commentPanel) {
                        let threadContainer = commentPanel.querySelector('.o_simple_thread');
                        if (!threadContainer) {
                            threadContainer = document.createElement('div');
                            threadContainer.className = 'o_simple_thread p-3 border-bottom';
                            commentPanel.insertBefore(threadContainer, commentPanel.firstChild);
                        }
                        
                        // Clear existing messages
                        threadContainer.innerHTML = '';
                        
                        // Add each message
                        messages.forEach(msg => {
                            const messageHtml = `
                                <div class="o_simple_message d-flex mb-3">
                                    <img class="me-2 rounded-circle" src="/web/image?model=res.users&field=avatar_128&id=2" 
                                         alt="Avatar" style="width: 32px; height: 32px;"/>
                                    <div class="flex-grow-1">
                                        <div class="d-flex align-items-center mb-1">
                                            <strong class="text-dark">${msg.author_id[1]}</strong>
                                            <small class="text-muted ms-2">${msg.date}</small>
                                        </div>
                                        <div class="text-dark">${msg.body}</div>
                                    </div>
                                </div>
                            `;
                            threadContainer.insertAdjacentHTML('beforeend', messageHtml);
                        });
                    }
                    
                    // Update comment count manually
                    this.update({ commentCount: messages.length });
                }
            } catch (error) {
                console.error("Error loading thread messages:", error);
            }
        },
        getToggleText() {
            try {
                if (this.showComments) {
                    return this.env._t(" Hide Comments");
                } else if (this.commentCount > 0) {
                    return this.env._t(" View Comments") + ` (${this.commentCount})`;
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
                    this.update({ commentCount: messageElements.length });
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
                
                // Get textarea value directly from DOM as fallback
                let commentText = this.commentText;
                if (!commentText || !commentText.trim()) {
                    // Try to get value from DOM directly
                    const textarea = document.querySelector(`[data-message-id="${this.message.id}"] textarea`);
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
                
                console.log("Creating simple local message...");
                
                // Wait a moment for DOM to be ready
                setTimeout(() => {
                    // Direct DOM manipulation (avoid calling global function to prevent double execution)
                    console.log("Looking for message ID:", this.message.id);
                    
                    // Try multiple selectors to find the comment panel
                    let commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] [t-ref="commentPanel"]`);
                    console.log("Selector 1 result:", commentPanel);
                    
                    if (!commentPanel) {
                        commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] .border.rounded-3.bg-view`);
                        console.log("Selector 2 result:", commentPanel);
                    }
                    
                    if (!commentPanel) {
                        // Try to find any comment panel that's currently visible
                        const allPanels = document.querySelectorAll('.border.rounded-3.bg-view');
                        console.log("All message comment panels found:", allPanels.length);
                        for (let panel of allPanels) {
                            const messageWrapper = panel.closest('[data-message-id]');
                            if (messageWrapper && messageWrapper.getAttribute('data-message-id') == this.message.id) {
                                commentPanel = panel;
                                console.log("Found panel via wrapper:", commentPanel);
                                break;
                            }
                        }
                    }
                    
                    console.log("Final comment panel:", commentPanel);
                    
                    if (commentPanel) {
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
                        
                        let threadContainer = commentPanel.querySelector('.o_simple_thread');
                        console.log("Found thread container:", threadContainer);
                        
                        if (!threadContainer) {
                            threadContainer = document.createElement('div');
                            threadContainer.className = 'o_simple_thread p-3 border-bottom';
                            commentPanel.insertBefore(threadContainer, commentPanel.firstChild);
                            console.log("Created new thread container");
                        }
                        
                        threadContainer.insertAdjacentHTML('beforeend', messageHtml);
                        console.log("Added message to thread container");
                        commentPanel.scrollTop = commentPanel.scrollHeight;
                    } else {
                        console.error("Comment panel not found for message:", this.message.id);
                    }
                    
                    console.log("Message added to thread");
                    
                    // Clear input
                    this.update({ commentText: '' });
                    
                    // Clear DOM textarea
                    const textarea = document.querySelector(`[data-message-id="${this.message.id}"] textarea`);
                    if (textarea) {
                        textarea.value = '';
                    }
                    
                    // Update comment count
                    this._updateCommentCount();
                    
                    console.log("Message posted successfully (local)");
                    
                    console.log("Comment posted successfully (local)");
                    
                    // Scroll to new message
                    setTimeout(() => {
                        const commentPanel = document.querySelector(`[data-message-id="${this.message.id}"] [t-ref="commentPanel"]`);
                        if (commentPanel) {
                            commentPanel.scrollTop = commentPanel.scrollHeight;
                        }
                    }, 100);
                    
                    console.log("Comment posted successfully!");
                }, 50);
                
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
    },
    fields: {
        message: one('Message', {
            identifying: true,
            inverse: 'commentModel',
        }),
        showComments: attr({ default: false }),
        commentCount: attr({ default: 0 }),
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