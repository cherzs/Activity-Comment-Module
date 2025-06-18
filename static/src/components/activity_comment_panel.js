/** @odoo-module **/

import { registerModel, registerPatch } from '@mail/model/model_core';
import { attr, many, one } from '@mail/model/model_field';
// import { moment } from '@web/core/l10n/dates';

// Global function to force UI update
window.forceUIUpdate = function() {
    try {
        console.log("Forcing UI update for all comment buttons...");
        // Find all comment buttons and trigger a small update
        const allButtons = document.querySelectorAll('.o_activity_comment_btn');
        allButtons.forEach(button => {
            const span = button.querySelector('span');
            if (span) {
                // Force a tiny DOM change to trigger re-render
                const currentText = span.textContent;
                span.textContent = currentText + ' ';
                setTimeout(() => {
                    span.textContent = currentText;
                }, 10);
            }
        });
    } catch (error) {
        console.error("Error forcing UI update:", error);
    }
};

// Global function to create models and load comment counts silently
window.loadAllCommentCounts = function() {
    console.log("Loading comment counts silently without UI interaction...");
    try {
        // Find all comment buttons and create models directly
        const allCommentButtons = document.querySelectorAll('.o_activity_comment_btn');
        console.log("Found", allCommentButtons.length, "total comment buttons");
        
        allCommentButtons.forEach((button, index) => {
            const activityWrapper = button.closest('[data-activity-id]');
            const messageWrapper = button.closest('[data-message-id]');
            
            if (activityWrapper) {
                const activityId = activityWrapper.getAttribute('data-activity-id');
                console.log(`Processing activity ${index} for activity:`, activityId);
                
                // Create model and load count directly without clicking
                setTimeout(() => {
                    try {
                        if (typeof odoo !== 'undefined' && odoo.__DEBUG__ && odoo.__DEBUG__.services) {
                            const messaging = odoo.__DEBUG__.services['@mail/model/model_manager'].messaging;
                            if (messaging && messaging.models) {
                                // Find the activity
                                const activities = messaging.models.Activity ? messaging.models.Activity.all() : [];
                                const activity = activities.find(a => a.id == activityId);
                                
                                if (activity && !activity.commentModel) {
                                    const commentModel = messaging.models['ActivityCommentModel'].insert({
                                        activity: activity,
                                    });
                                    console.log("Silently created comment model for activity:", activityId);
                                    
                                    // Load count immediately
                                    setTimeout(() => {
                                        if (activity.commentModel) {
                                            activity.commentModel._loadCommentCountFromDatabase();
                                        }
                                    }, 100);
                                } else if (activity && activity.commentModel) {
                                    console.log("Loading count for existing activity:", activityId);
                                    activity.commentModel._loadCommentCountFromDatabase();
                                }
                            }
                        }
                    } catch (error) {
                        console.error("Error processing activity", activityId, ":", error);
                    }
                }, index * 100); // Stagger processing
                
            } else if (messageWrapper) {
                const messageId = messageWrapper.getAttribute('data-message-id');
                console.log(`Processing message ${index} for message:`, messageId);
                
                // Create model and load count directly without clicking
                setTimeout(() => {
                    try {
                        if (typeof odoo !== 'undefined' && odoo.__DEBUG__ && odoo.__DEBUG__.services) {
                            const messaging = odoo.__DEBUG__.services['@mail/model/model_manager'].messaging;
                            if (messaging && messaging.models) {
                                // Find the message
                                const messages = messaging.models.Message ? messaging.models.Message.all() : [];
                                const message = messages.find(m => m.id == messageId);
                                
                                if (message && !message.commentModel) {
                                    const commentModel = messaging.models['MessageActivityCommentModel'].insert({
                                        message: message,
                                    });
                                    console.log("Silently created comment model for message:", messageId);
                                    
                                    // Load count immediately
                                    setTimeout(() => {
                                        if (message.commentModel) {
                                            message.commentModel._loadCommentCountFromDatabase();
                                        }
                                    }, 100);
                                } else if (message && message.commentModel) {
                                    console.log("Loading count for existing message:", messageId);
                                    message.commentModel._loadCommentCountFromDatabase();
                                }
                            }
                        }
                    } catch (error) {
                        console.error("Error processing message", messageId, ":", error);
                    }
                }, index * 100); // Stagger processing
            }
        });
        
    } catch (error) {
        console.error("Error loading all comment counts:", error);
    }
};

// Auto-load all counts after page is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM loaded, starting comment count loading sequence...");
    
    // Try only once after elements are loaded
    setTimeout(() => {
        console.log("Loading comment counts via simulated clicks...");
        window.loadAllCommentCounts();
    }, 2000);
});

// Also try when window is fully loaded
window.addEventListener('load', function() {
    console.log("Window fully loaded, loading comment counts...");
    setTimeout(() => {
        window.loadAllCommentCounts();
    }, 1000);
});

// Global fallback function for toggle comments
window.activityToggleComments = function(activityId) {
    console.log("Global activityToggleComments called for activity:", activityId);
    try {
        // Prevent infinite loop by checking if already processing
        if (window._processingActivityToggle) {
            console.log("Already processing, skipping to prevent infinite loop");
            return;
        }
        window._processingActivityToggle = true;
        
        // Try to find the comment model directly from messaging system
        if (typeof odoo !== 'undefined' && odoo.__DEBUG__ && odoo.__DEBUG__.services) {
            try {
                const messaging = odoo.__DEBUG__.services['@mail/model/model_manager'].messaging;
                if (messaging && messaging.models && messaging.models.ActivityCommentModel) {
                    const commentModels = messaging.models.ActivityCommentModel.all();
                    const targetModel = commentModels.find(model => model.activity && model.activity.id == activityId);
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
        console.log("Using fallback method for activity:", activityId);
        
    } catch (error) {
        console.error("Error in global activityToggleComments:", error);
    } finally {
        // Reset the flag after processing
        setTimeout(() => {
            window._processingActivityToggle = false;
        }, 100);
    }
};

// Global fallback function
window.activitySubmitComment = function() {
    console.log("Global activitySubmitComment called");
    try {
        // Find the active textarea and get its value
        const activeTextarea = document.querySelector('[data-activity-id] textarea:focus') || 
                              document.querySelector('[data-activity-id] textarea');
        if (activeTextarea && activeTextarea.value.trim()) {
            const commentText = activeTextarea.value.trim();
            console.log("Global submit with text:", commentText);
            
            // Create a simple message display
            const activityId = activeTextarea.closest('[data-activity-id]').getAttribute('data-activity-id');
            let commentPanel = document.querySelector(`[data-activity-id="${activityId}"] [t-ref="commentPanel"]`);
            
            if (!commentPanel) {
                commentPanel = document.querySelector(`[data-activity-id="${activityId}"] .border.rounded-3.bg-view`);
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
    name: 'ActivityCommentModel',
    recordMethods: {
        /**
         * Initialize the model and load saved state
         */
        _created() {
            if (this.activity && this.activity.id) {
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
                console.log("toggleComments called, current showComments:", this.showComments);
                const newState = !this.showComments;
                console.log("Setting showComments to:", newState);
                this.update({ showComments: newState });
                console.log("After update, showComments is:", this.showComments);
                
                if (!newState) {
                    // Hiding comments - reset composer and remove expanded class
                    console.log("Hiding comments");
                    this.update({ needsComposer: false });
                    // Remove expanded class
                    setTimeout(() => {
                        const wrapper = document.querySelector(`[data-activity-id="${this.activity.id}"] .o_activity_comment_panel_wrapper`);
                        if (wrapper) {
                            wrapper.classList.remove('o_comment_panel_expanded');
                        }
                    }, 10);
                } else {
                    // Showing comments - show composer and load messages from database
                    console.log("Showing comments");
                    this.update({ needsComposer: true });
                    // Add expanded class for full width
                    setTimeout(() => {
                        const wrapper = document.querySelector(`[data-activity-id="${this.activity.id}"] .o_activity_comment_panel_wrapper`);
                        if (wrapper) {
                            wrapper.classList.add('o_comment_panel_expanded');
                        }
                    }, 10);
                    
                    // Check if we already have thread and messages loaded
                    if (this.thread && this.thread.id) {
                        console.log("Thread already exists, loading messages for thread:", this.thread.id);
                        // Just reload messages for existing thread
                        setTimeout(() => {
                            this._loadThreadMessages(this.thread.id);
                        }, 50); // Faster DOM ready check
                    } else {
                        console.log("No thread exists, creating new thread");
                        // Load existing messages from database
                        this.preloadThread();
                    }
                    
                    // Setup message listener when first showing comments
                    this._setupMessageListener();
                }
                console.log("toggleComments completed, final showComments:", this.showComments);
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
                    args: [[['activity_id', '=', this.activity.id]]],
                    kwargs: {
                        fields: ['id', 'name', 'activity_id'],
                        limit: 1
                    }
                });
                
                let threadId;
                if (threadData && threadData.length > 0) {
                    threadId = threadData[0].id;
                } else {
                    // Create new thread for this activity
                    threadId = await rpc({
                        model: 'mail.activity.thread',
                        method: 'create',
                        args: [[{
                            'activity_id': this.activity.id,
                            'name': `Comments for ${this.activity.display_name || 'Activity'}`,
                            'res_model': this.activity.res_model,
                            'res_id': this.activity.res_id,
                        }]]
                    });
                }
                
                // Create thread object with real ID
                const thread = this.messaging.models['Thread'].insert({
                    id: threadId,
                    model: 'mail.activity.thread',
                    name: `Comments for ${this.activity.display_name || 'Activity'}`,
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
                console.log("Loading thread messages for threadId:", threadId);
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
                
                console.log("Found messages from server:", messages ? messages.length : 0);
                
                if (messages && messages.length > 0) {
                    // Immediate render with fallback
                    this._renderMessagesToDOM(messages);
                    
                    // Fallback render if first attempt fails
                    setTimeout(() => {
                        const commentPanel = document.querySelector(`[data-activity-id="${this.activity.id}"] [t-ref="commentPanel"]`);
                        if (commentPanel) {
                            const existingMessages = commentPanel.querySelectorAll('.o_simple_message');
                            if (existingMessages.length === 0) {
                                console.log("Fallback render needed");
                                this._renderMessagesToDOM(messages);
                            }
                        }
                    }, 100);
                    
                    // Update comment count manually
                    this.update({ commentCount: messages.length });
                } else {
                    console.log("No messages found for threadId:", threadId, "- thread might be empty");
                    // Even if no messages, ensure we have a thread container for new messages
                    const commentPanel = document.querySelector(`[data-activity-id="${this.activity.id}"] [t-ref="commentPanel"]`);
                    if (commentPanel) {
                        let threadContainer = commentPanel.querySelector('.o_simple_thread');
                        if (!threadContainer) {
                            threadContainer = document.createElement('div');
                            threadContainer.className = 'o_simple_thread p-3 border-bottom';
                            threadContainer.innerHTML = '<p class="text-muted text-center p-2">No comments yet. Be the first to comment!</p>';
                            commentPanel.insertBefore(threadContainer, commentPanel.firstChild);
                            console.log("Created empty thread container with placeholder");
                        }
                    }
                }
            } catch (error) {
                console.error("Error loading thread messages:", error);
                // Create empty thread container even on error
                const commentPanel = document.querySelector(`[data-activity-id="${this.activity.id}"] [t-ref="commentPanel"]`);
                if (commentPanel && !commentPanel.querySelector('.o_simple_thread')) {
                    const threadContainer = document.createElement('div');
                    threadContainer.className = 'o_simple_thread p-3 border-bottom';
                    threadContainer.innerHTML = '<p class="text-muted text-center p-2">No comments yet. Be the first to comment!</p>';
                    commentPanel.insertBefore(threadContainer, commentPanel.firstChild);
                    console.log("Created fallback thread container due to error");
                }
            }
        },
        _renderMessagesToDOM(messages) {
            try {
                console.log("_renderMessagesToDOM called with", messages.length, "messages");
                
                // Try multiple selectors to find comment panel
                let commentPanel = document.querySelector(`[data-activity-id="${this.activity.id}"] [t-ref="commentPanel"]`);
                
                if (!commentPanel) {
                    commentPanel = document.querySelector(`[data-activity-id="${this.activity.id}"] .border.rounded-3.bg-view`);
                }
                
                if (!commentPanel) {
                    // Try to find any visible comment panel for this activity
                    const allPanels = document.querySelectorAll('.border.rounded-3.bg-view');
                    for (let panel of allPanels) {
                        const activityWrapper = panel.closest('[data-activity-id]');
                        if (activityWrapper && activityWrapper.getAttribute('data-activity-id') == this.activity.id) {
                            commentPanel = panel;
                            break;
                        }
                    }
                }
                
                console.log("Found comment panel:", commentPanel);
                
                if (commentPanel) {
                    let threadContainer = commentPanel.querySelector('.o_simple_thread');
                    if (!threadContainer) {
                        threadContainer = document.createElement('div');
                        threadContainer.className = 'o_simple_thread p-3 border-bottom';
                        commentPanel.insertBefore(threadContainer, commentPanel.firstChild);
                        console.log("Created new thread container for messages");
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
                    
                    console.log("Successfully added", messages.length, "messages to thread container");
                    
                    // Immediate scroll to bottom
                    commentPanel.scrollTop = commentPanel.scrollHeight;
                    
                } else {
                    console.error("Could not find comment panel for activity:", this.activity.id);
                    // Quick retry
                    setTimeout(() => {
                        console.log("Quick retry to render messages...");
                        this._renderMessagesToDOM(messages);
                    }, 100);
                }
            } catch (error) {
                console.error("Error rendering messages to DOM:", error);
            }
        },

        getToggleText() {
            try {
                console.log("getToggleText called - showComments:", this.showComments, "commentCount:", this.commentCount);
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
                const commentPanel = document.querySelector(`[data-activity-id="${this.activity.id}"] [t-ref="commentPanel"]`);
                if (commentPanel) {
                    const messageElements = commentPanel.querySelectorAll('.o_simple_message');
                    const count = messageElements.length;
                    this.update({ commentCount: count });
                    // Save count to localStorage to persist across reloads
                    this._saveCommentCount(count);
                }
            } catch (e) { console.error("Error in _updateCommentCount:", e); }
        },
        _checkSessionStorage() {
            try {
                const storedInfo = sessionStorage.getItem('open_activity_comments');
                if (storedInfo) {
                    const threadInfo = JSON.parse(storedInfo);
                    if (threadInfo &&
                        threadInfo.threadModel === 'mail.activity.thread' &&
                        threadInfo.activityId &&
                        threadInfo.activityId === this.activity.id) {
                        if (!this.showComments) {
                            this.update({ showComments: true });
                        }
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
                
                // Listen for activity updates (if supported)
                if (this.activity && typeof this.activity.on === 'function') {
                    this.activity.on('activity_updated', this, this._onActivityUpdated);
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
                    const commentPanel = document.querySelector(`[data-activity-id="${this.activity.id}"] [t-ref="commentPanel"]`);
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
        _onActivityUpdated() {
            try {
                // Refresh the display when activity is updated
                this.update({});
            } catch (error) {
                console.error("Error handling activity updated:", error);
            }
        },
        _saveThreadState() {
            try {
                const threadState = {
                    activityId: this.activity.id,
                    threadId: this.thread ? this.thread.id : null,
                    commentCount: this.commentCount,
                    showComments: this.showComments,
                    timestamp: Date.now()
                };
                localStorage.setItem(`activity_thread_${this.activity.id}`, JSON.stringify(threadState));
            } catch (error) {
                console.error("Error saving thread state:", error);
            }
        },
        _loadThreadState() {
            try {
                const savedState = localStorage.getItem(`activity_thread_${this.activity.id}`);
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
                console.error("Error loading thread state:", error);
            }
        },
        _saveCommentCount(count) {
            try {
                localStorage.setItem(`activity_comments_${this.activity.id}`, count.toString());
            } catch (error) {
                console.error("Error saving comment count:", error);
            }
        },
        _loadCommentCount() {
            try {
                const savedCount = localStorage.getItem(`activity_comments_${this.activity.id}`);
                if (savedCount) {
                    this.update({ commentCount: parseInt(savedCount) || 0 });
                }
            } catch (error) {
                console.error("Error loading comment count:", error);
            }
        },
        async _loadCommentCountFromDatabase() {
            try {
                console.log("Loading comment count from database for activity:", this.activity.id);
                const rpc = this.messaging.rpc || this.env.services.rpc;
                
                // First check if thread exists for this activity
                const threadData = await rpc({
                    model: 'mail.activity.thread',
                    method: 'search_read',
                    args: [[['activity_id', '=', this.activity.id]]],
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
                    
                    console.log("Found", messageCount, "comments in database for activity:", this.activity.id);
                    
                    // Update comment count
                    this.update({ commentCount: messageCount });
                    // Save to localStorage for faster future loads
                    this._saveCommentCount(messageCount);
                    
                    console.log("Updated activity", this.activity.id, "comment count to:", messageCount);
                    
                    // Force UI update to show the new count
                    setTimeout(() => {
                        if (window.forceUIUpdate) {
                            window.forceUIUpdate();
                        }
                    }, 50);
                } else {
                    console.log("No thread found for activity:", this.activity.id, "- setting count to 0");
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
                const commentPanel = document.querySelector(`[data-activity-id="${this.activity.id}"] [t-ref="commentPanel"]`);
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
                console.error("Error restoring thread messages:", error);
            }
        },
        _triggerRerender() {
            try {
                // Simple rerender without causing loops
                console.log("Triggering rerender for activity:", this.activity.id, "with count:", this.commentCount);
                // Just update the model to trigger reactive updates
                this.update({});
            } catch (error) {
                console.error("Error triggering rerender:", error);
            }
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
        canPostMessage() {
            try {
                const hasCommentText = this.commentText && this.commentText.trim() !== '';
                const hasAttachments = this.attachments && this.attachments.length > 0;
                return hasCommentText || hasAttachments;
            } catch (error) { console.error("Error in canPostMessage:", error); return false; }
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
        async submitComment() {
            try {
                console.log("submitComment called");
                
                // First, sync the model with current textarea value
                const textarea = document.querySelector(`[data-activity-id="${this.activity.id}"] textarea`);
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
                
                console.log("Saving comment to database...");
                
                // Save comment to database via thread's message_post
                try {
                    // First ensure thread exists
                    await this.preloadThread();
                    
                    if (this.thread && this.thread.id) {
                        console.log("Posting comment to thread ID:", this.thread.id);
                        
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
                        
                        console.log("Comment saved to database, message ID:", messageData);
                        
                        // Reload thread messages from database to update UI
                        await this._loadThreadMessages(this.thread.id);
                        
                        // Clear input after successful save
                        this.update({ commentText: '' });
                        
                        // Clear DOM textarea
                        const textarea = document.querySelector(`[data-activity-id="${this.activity.id}"] textarea`);
                        if (textarea) {
                            textarea.value = '';
                        }
                        
                        console.log("Comment posted successfully to database!");
                        
                    } else {
                        console.error("No thread available for activity:", this.activity.id);
                        alert("Error: Could not create thread for comments");
                    }
                    
                } catch (error) {
                    console.error("Error saving comment to database:", error);
                    alert("Error saving comment: " + error.message);
                }
                
            } catch (error) {
                console.error("Error in submitComment:", error);
                console.error("Error posting comment: " + error.message);
            }
        },

        toggleEmoji(event) {
            // (copy emoji picker logic dari models.js, jika belum ada)
        },
        insertEmoji(emoji) {
            // (copy emoji insert logic dari models.js, jika belum ada)
        },
        async uploadFile() {
            // (copy upload file logic dari models.js, jika belum ada)
        },
        async retryLocalMessages() {
            // (copy retry local messages logic dari models.js, jika belum ada)
        },
    },
    fields: {
        activity: one('Activity', {
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
    name: 'Activity',
    fields: {
        commentModel: one('ActivityCommentModel', {
            inverse: 'activity',
            isCausal: true,
        }),
    },
});

registerPatch({
    name: 'ActivityView',
    recordMethods: {
        _created() {
            // Call parent _created if it exists
            if (this._super) {
                this._super();
            }
            // Ensure comment model is created and loaded
            if (this.activity && this.activity.id) {
                setTimeout(() => {
                    this._ensureCommentModel();
                }, 100);
            }
        },
        _ensureCommentModel() {
            try {
                if (!this.activity.commentModel) {
                    const commentModel = this.messaging.models['ActivityCommentModel'].insert({
                        activity: this.activity,
                    });
                    console.log("Auto-created comment model for activity:", this.activity.id);
                    // Load comment count immediately
                    setTimeout(() => {
                        if (this.activity.commentModel) {
                            this.activity.commentModel._loadCommentCountFromDatabase();
                        }
                    }, 50);
                } else {
                    // Model already exists, just load count
                    this.activity.commentModel._loadCommentCountFromDatabase();
                }
            } catch (error) {
                console.error("Error ensuring comment model:", error);
            }
        },
        toggleComments() {
            try {
                // Ensure commentModel exists
                if (!this.activity.commentModel) {
                    try {
                        // Create the comment model explicitly
                        const commentModel = this.messaging.models['ActivityCommentModel'].insert({
                            activity: this.activity,
                        });
                        console.log("Created comment model for activity:", this.activity.id);
                        
                        // Give a moment for the causal relationship to link
                        setTimeout(() => {
                            if (this.activity.commentModel) {
                                this.activity.commentModel.toggleComments();
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
                
                if (this.activity.commentModel) {
                    this.activity.commentModel.toggleComments();
                } else {
                    console.warn("Could not create comment model for activity");
                }
            } catch (error) {
                console.error("Error in ActivityView.toggleComments:", error);
            }
        },

    },
}); 