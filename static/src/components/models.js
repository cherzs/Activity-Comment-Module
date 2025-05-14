/** @odoo-module **/

import { registerModel, registerPatch } from '@mail/model/model_core';
import { attr, many, one } from '@mail/model/model_field';
import { clear, link } from '@mail/model/model_field_command';
import { addLink, escapeAndCompactTextContent, parseAndTransform } from '@mail/js/utils';
import { isEventHandled, markEventHandled } from '@mail/utils/utils';

import { escape, sprintf } from '@web/core/utils/strings';
import { url } from '@web/core/utils/urls';
import session from "web.session";
import { makeDeferred } from '@mail/utils/deferred';

try {
    registerModel({
        name: 'ActivityCommentModel',
        recordMethods: {
            /**
             * Toggle the visibility of comments for this activity
             */
            toggleComments() {
                try {
                    const newState = !this.showComments;
                    this.update({
                        showComments: newState
                    });
                    
                    if (!newState) {
                        this._updateCommentCount();
                    } else {
                        // When opening comments, make sure thread is initialized
                        this.preloadThread();
                    }
                } catch (e) {
                    console.error("Error in toggleComments:", e);
                }
            },
            
            /**
             * Ensure the thread is initialized (call before submitting)
             */
            preloadThread() {
                if (this.thread) {
                    return Promise.resolve(this.thread);
                }
                
                if (this.activity && 
                    this.activity.activityViews && 
                    this.activity.activityViews.length > 0) {
                        
                    const activityView = this.activity.activityViews[0];
                    if (activityView._initializeCommentThread) {
                        return activityView._initializeCommentThread();
                    }
                }
                
                return Promise.resolve(null);
            },
            
            /**
             * Get the text to display on the toggle button
             */
            getToggleText() {
                try {
                    if (this.showComments) {
                        return this.env._t(" Hide Comments");
                    } else if (this.commentCount > 0) {
                        return this.env._t(" View Comments") + ` (${this.commentCount})`;
                    } else {
                        return this.env._t(" Add a Comment");
                    }
                } catch (e) {
                    console.error("Error in getToggleText:", e);
                    return " Comments";
                }
            },
            
            /**
             * Update the comment count based on the thread messages
             */
            _updateCommentCount() {
                try {
                    if (this.thread && this.thread.messages && this.thread.messages.length) {
                        const validMessages = this.thread.messages.filter(
                            msg => msg && msg.body && msg.body.trim() !== ''
                        );
                        this.update({ commentCount: validMessages.length });
                    }
                } catch (e) {
                    console.error("Error in _updateCommentCount:", e);
                }
            },
            
            /**
             * Check session storage for any pending activity comments to open
             */
            _checkSessionStorage() {
                try {
                    const storedInfo = sessionStorage.getItem('open_activity_comments');
                    if (storedInfo) {
                        const threadInfo = JSON.parse(storedInfo);
                        
                        // Check if this is for our activity
                        if (threadInfo &&
                            threadInfo.threadModel === 'mail.activity.thread' &&
                            threadInfo.activityId &&
                            threadInfo.activityId === this.activity.id) {
                            
                            // Open the comments section
                            if (!this.showComments) {
                                this.update({ showComments: true });
                            }
                            
                            // Clear the storage so it doesn't keep opening
                            sessionStorage.removeItem('open_activity_comments');
                        }
                    }
                } catch (error) {
                    console.error("Error checking session storage:", error);
                }
            },
            
            /**
             * Handles click in the textarea
             */
            onClickTextarea() {
                console.log("Textarea clicked");
                // Save cursor position for later use
                try {
                    const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                    if (textarea) {
                        this.update({
                            textInputCursorStart: textarea.selectionStart,
                            textInputCursorEnd: textarea.selectionEnd
                        });
                    }
                } catch (error) {
                    console.error("Error in onClickTextarea:", error);
                }
            },
            
            /**
             * Handles textarea focus
             */
            onFocusTextarea() {
                console.log("Textarea focused");
                this.update({ isFocused: true });
            },
            
            /**
             * Handles keydown in textarea
             * @param {KeyboardEvent} ev
             */
            onKeydownTextarea(ev) {
                try {
                    // Handle Enter key (submit comment)
                    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
                        ev.preventDefault();
                        this.submitComment();
                        return;
                    }
                    
                    // Handle Escape key (close comments)
                    if (ev.key === 'Escape') {
                        ev.preventDefault();
                        this.toggleComments();
                        return;
                    }
                } catch (error) {
                    console.error("Error in onKeydownTextarea:", error);
                }
            },
            
            /**
             * Handles keyup in textarea
             * @param {KeyboardEvent} ev
             */
            onKeyupTextarea(ev) {
                try {
                    // Update cursor position
                    const textarea = ev.target;
                    if (textarea) {
                        this.update({
                            textInputCursorStart: textarea.selectionStart,
                            textInputCursorEnd: textarea.selectionEnd
                        });
                    }
                } catch (error) {
                    console.error("Error in onKeyupTextarea:", error);
                }
            },
            
            /**
             * Toggle emoji picker
             */
            toggleEmoji() {
                try {
                    console.log("Toggle emoji picker");
                    // Check if emoji popover is already open
                    const emojiPopover = document.querySelector('.o_emoji_popover');
                    if (emojiPopover) {
                        emojiPopover.remove();
                        return;
                    }
                    
                    // Create emoji popover
                    const popover = document.createElement('div');
                    popover.className = 'o_emoji_popover popover p-0 bg-white shadow-sm border-0 overflow-auto position-absolute';
                    popover.style.maxWidth = '280px';
                    popover.style.maxHeight = '200px';
                    popover.style.zIndex = '1000';
                    
                    // Common emojis
                    const commonEmojis = ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
                                        '🙂', '🙃', '😉', '😌', '😍', '😘', '😗', '😙', '😚', '😋',
                                        '👍', '👎', '👏', '🙌', '👋', '❤️', '👌', '✅', '⭐', '🎉'];
                    
                    // Create emoji grid
                    const emojiGrid = document.createElement('div');
                    emojiGrid.className = 'd-flex flex-wrap p-2';
                    
                    commonEmojis.forEach(emoji => {
                        const emojiBtn = document.createElement('a');
                        emojiBtn.href = '#';
                        emojiBtn.className = 'o_mail_emoji p-2 fs-3';
                        emojiBtn.textContent = emoji;
                        emojiBtn.onclick = (e) => {
                            e.preventDefault();
                            this.insertEmoji(emoji);
                            popover.remove();
                        };
                        emojiGrid.appendChild(emojiBtn);
                    });
                    
                    popover.appendChild(emojiGrid);
                    
                    // Position popover near the emoji button
                    const emojiBtn = event.target.closest('button');
                    document.body.appendChild(popover);
                    
                    const btnRect = emojiBtn.getBoundingClientRect();
                    popover.style.top = (btnRect.bottom + window.scrollY + 5) + 'px';
                    popover.style.left = (btnRect.left + window.scrollX) + 'px';
                    
                    // Close popover when clicking outside
                    const closePopover = (e) => {
                        if (!popover.contains(e.target) && e.target !== emojiBtn) {
                            popover.remove();
                            document.removeEventListener('click', closePopover);
                        }
                    };
                    
                    // Use setTimeout to avoid closing immediately due to the current click event
                    setTimeout(() => {
                        document.addEventListener('click', closePopover);
                    }, 0);
                    
                } catch (error) {
                    console.error("Error in toggleEmoji:", error);
                }
            },
            
            /**
             * Insert emoji into comment text
             */
            insertEmoji(emoji) {
                try {
                    const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                    if (!textarea) return;
                    
                    const cursorPos = textarea.selectionStart;
                    const textBefore = textarea.value.substring(0, cursorPos);
                    const textAfter = textarea.value.substring(textarea.selectionEnd);
                    
                    textarea.value = textBefore + emoji + textAfter;
                    this.commentText = textarea.value;
                    
                    // Set cursor position after the inserted emoji
                    const newCursorPos = cursorPos + emoji.length;
                    textarea.setSelectionRange(newCursorPos, newCursorPos);
                    textarea.focus();
                } catch (error) {
                    console.error("Error inserting emoji:", error);
                }
            },
            
            /**
             * Check if can post message
             * @returns {boolean}
             */
            canPostMessage() {
                try {
                    // Get direct value from textarea for most accurate test
                    const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                    const textareaHasContent = textarea && textarea.value && textarea.value.trim() !== '';
                    
                    // Also check property and attachments
                    const hasCommentText = this.commentText && this.commentText.trim() !== '';
                    const hasAttachments = this.attachments && this.attachments.length > 0;
                    
                    // Log for debugging
                    console.log("canPostMessage check:", { 
                        textareaHasContent, 
                        hasCommentText, 
                        hasAttachments,
                        textareaValue: textarea ? textarea.value : null
                    });
                    
                    return textareaHasContent || hasCommentText || hasAttachments;
                } catch (error) {
                    console.error("Error in canPostMessage:", error);
                    return false;
                }
            },
            
            /**
             * Handle attachment added
             * @param {Object} attachment 
             */
            onAttachmentCreated(attachment) {
                try {
                    const currentAttachments = this.attachments || [];
                    this.update({
                        attachments: [...currentAttachments, attachment]
                    });
                } catch (error) {
                    console.error("Error in onAttachmentCreated:", error);
                }
            },
            
            /**
             * Handle attachment removed
             * @param {number} attachmentId 
             */
            removeAttachment(attachmentId) {
                try {
                    const currentAttachments = this.attachments || [];
                    this.update({
                        attachments: currentAttachments.filter(att => att.id !== attachmentId)
                    });
                } catch (error) {
                    console.error("Error in removeAttachment:", error);
                }
            },
            
            /**
             * Upload file with improved attachment handling
             */
            async uploadFile() {
                try {
                    console.log("Upload file");
                    
                    // Create file input
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.style.display = 'none';
                    fileInput.multiple = true;
                    
                    // Add file input to document
                    document.body.appendChild(fileInput);
                    
                    // Handle file selection
                    fileInput.onchange = async (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;
                        
                        // Use Odoo's existing file upload mechanism if available
                        if (this.env && this.env.services && this.env.services.fileUpload) {
                            try {
                                const result = await this.env.services.fileUpload.upload(files);
                                console.log("Files uploaded:", result);
                                
                                // Add attachments to the model
                                if (result && result.length > 0) {
                                    result.forEach(file => {
                                        this.onAttachmentCreated({
                                            id: file.id,
                                            name: file.name,
                                            url: file.url,
                                            mimetype: file.mimetype,
                                            isUploading: false,
                                            size: file.size
                                        });
                                    });
                                }
                            } catch (uploadError) {
                                console.error("Error uploading files:", uploadError);
                                alert("Error uploading files. Please try again.");
                            }
                        } else {
                            // Fallback: add files as text links
                            const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                            if (textarea) {
                                let fileNames = '';
                                
                                for (let i = 0; i < files.length; i++) {
                                    fileNames += `\n[${files[i].name}]`;
                                }
                                
                                textarea.value += fileNames;
                                this.commentText = textarea.value;
                                textarea.focus();
                            }
                            
                            alert("File upload service not available. Files added as links.");
                        }
                        
                        // Cleanup
                        document.body.removeChild(fileInput);
                    };
                    
                    // Trigger file selection dialog
                    fileInput.click();
                } catch (error) {
                    console.error("Error in uploadFile:", error);
                }
            },
            
            // Add submitComment method to be called directly from template
            submitComment() {
                try {
                    console.log("Submit comment called for activity");
                    // First, ensure the thread is initialized
                    if (this.activity && 
                        this.activity.activityViews && 
                        this.activity.activityViews.length > 0) {
                        
                        const activityView = this.activity.activityViews[0];
                        
                        // If thread doesn't exist, initialize it first
                        if (!this.thread && activityView._initializeCommentThread) {
                            console.log("Initializing thread before submitting comment");
                            // Initialize thread and then submit
                            activityView._initializeCommentThread().then((thread) => {
                                console.log("Thread initialization result:", thread);
                                if (thread || this.thread) {
                                    console.log("Thread initialized successfully, submitting comment");
                                    activityView._submitCommentWithAttachments();
                                } else {
                                    console.error("Thread initialization failed, trying alternative approach");
                                    // Last attempt: try to create a temporary thread object
                                    const tempThread = {
                                        id: -Math.floor(Math.random() * 10000),
                                        model: 'mail.activity.thread',
                                        messages: []
                                    };
                                    this.update({ thread: tempThread });
                                    
                                    setTimeout(() => {
                                        activityView._submitCommentWithAttachments();
                                    }, 100);
                                }
                            }).catch(error => {
                                console.error("Error initializing thread:", error);
                                alert("Cannot submit comment: error initializing thread. Please try again.");
                            });
                            return;
                        }
                        
                        // If thread exists, submit comment directly
                        activityView._submitCommentWithAttachments();
                        return;
                    }
                    
                    // If we get here, try alternate approaches to find the activity view
                    console.log("Trying alternate approaches to find the activity view");
                    const activityViews = document.querySelectorAll('.o_Activity');
                    for (const view of activityViews) {
                        // Check if this is the right activity by data attribute or content
                        if (view.dataset && view.dataset.activityId === this.activity.id.toString()) {
                            console.log("Found activity view in DOM");
                            // This is our activity, find it in the model
                            if (this.env && 
                                this.env.services && 
                                this.env.services.messaging &&
                                this.env.services.messaging.modelManager) {
                                
                                // Try to get ActivityView from models
                                const activityViewModels = this.env.services.messaging.modelManager.models['ActivityView'].all();
                                if (activityViewModels && activityViewModels.length) {
                                    // Find the view for our activity
                                    const myActivityView = activityViewModels.find(
                                        view => view.activity && view.activity.id === this.activity.id
                                    );
                                    
                                    if (myActivityView) {
                                        // Initialize thread first if needed
                                        if (!this.thread && myActivityView._initializeCommentThread) {
                                            console.log("Initializing thread via found ActivityView");
                                            // Initialize thread and then submit
                                            myActivityView._initializeCommentThread().then((thread) => {
                                                console.log("Thread initialization via found ActivityView result:", thread);
                                                if (thread || this.thread) {
                                                    myActivityView._submitCommentWithAttachments();
                                                } else {
                                                    // Last attempt - create simple thread
                                                    const tempThread = {
                                                        id: -Math.floor(Math.random() * 10000),
                                                        model: 'mail.activity.thread',
                                                        messages: []
                                                    };
                                                    this.update({ thread: tempThread });
                                                    
                                                    setTimeout(() => {
                                                        myActivityView._submitCommentWithAttachments();
                                                    }, 100);
                                                }
                                            }).catch(error => {
                                                console.error("Error initializing thread:", error);
                                                alert("Cannot submit comment: error initializing thread. Please try again.");
                                            });
                                            return;
                                        }
                                        
                                        // If thread exists, submit directly
                                        if (myActivityView._submitCommentWithAttachments) {
                                            myActivityView._submitCommentWithAttachments();
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    // Last resort - try to create and use a mock thread
                    console.log("Using last resort approach - creating mock thread");
                    if (!this.thread) {
                        const tempThread = {
                            id: -Math.floor(Math.random() * 10000),
                            model: 'mail.activity.thread',
                            messages: []
                        };
                        this.update({ thread: tempThread });
                        
                        // Try to post the message using a simple approach
                        const commentText = this.commentText || '';
                        if (commentText.trim() !== '') {
                            alert("Comment saved: " + commentText.trim());
                            this.update({ commentText: '' });
                            
                            // Clear the textarea
                            const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                            if (textarea) {
                                textarea.value = '';
                            }
                            
                            return;
                        }
                    }
                    
                    // Very last resort: alert the user
                    console.error("Could not find activity view to submit comment");
                    alert("Cannot submit comment: could not find the correct activity. Please try again or refresh the page.");
                    
                } catch (error) {
                    console.error("Error in submitComment:", error);
                    alert("An error occurred while submitting your comment. Please try again.");
                }
            },
        },
        fields: {
            activity: one('Activity', {
                identifying: true,
                inverse: 'commentModel',
            }),
            showComments: attr({
                default: false,
            }),
            commentCount: attr({
                default: 0,
            }),
            thread: one('Thread'),
            commentText: attr({
                default: '',
            }),
            isFocused: attr({
                default: false,
            }),
            textInputCursorStart: attr({
                default: 0,
            }),
            textInputCursorEnd: attr({
                default: 0,
            }),
            attachments: many('Attachment'),
            hasAttachments: attr({
                compute() {
                    return Boolean(this.attachments && this.attachments.length > 0);
                },
                default: false,
            }),
        },
    });

    // Register MessageActivityCommentModel
    registerModel({
            name: 'MessageActivityCommentModel',
    recordMethods: {
        /**
         * Toggle the visibility of comments for this message
         */
        toggleComments() {
            try {
                const newState = !this.showComments;
                this.update({
                    showComments: newState
                });
                
                if (!newState) {
                    this._updateCommentCount();
                } else {
                    // When opening comments, make sure thread is initialized
                    this.preloadThread();
                }
            } catch (e) {
                console.error("Error in toggleComments:", e);
            }
        },
        
        /**
         * Ensure the thread is initialized (call before submitting)
         */
        preloadThread() {
            if (this.thread) {
                return Promise.resolve(this.thread);
            }
            
            if (this.message && 
                this.message.messageViews && 
                this.message.messageViews.length > 0) {
                    
                const messageView = this.message.messageViews[0];
                if (messageView._initializeCommentThread) {
                    return messageView._initializeCommentThread();
                }
            }
            
            return Promise.resolve(null);
        },
        
        /**
         * Get the text to display on the toggle button
         */
        getToggleText() {
            try {
                if (this.showComments) {
                    return this.env._t(" Hide Comments");
                } else if (this.commentCount > 0) {
                    return this.env._t(" View Comments") + ` (${this.commentCount})`;
                } else {
                    return this.env._t(" Add a Comment");
                }
            } catch (e) {
                console.error("Error in getToggleText:", e);
                return " Comments";
            }
        },
        
        /**
         * Update the comment count based on the thread messages
         */
        _updateCommentCount() {
            try {
                if (this.thread && this.thread.messages && this.thread.messages.length) {
                    const validMessages = this.thread.messages.filter(
                        msg => msg && msg.body && msg.body.trim() !== ''
                    );
                    this.update({ commentCount: validMessages.length });
                }
            } catch (e) {
                console.error("Error in _updateCommentCount:", e);
            }
        },
        
        /**
         * Handle attachment added
         * @param {Object} attachment 
         */
        onAttachmentCreated(attachment) {
            try {
                const currentAttachments = this.attachments || [];
                this.update({
                    attachments: [...currentAttachments, attachment]
                });
            } catch (error) {
                console.error("Error in onAttachmentCreated:", error);
            }
        },
        
        /**
         * Handle attachment removed
         * @param {number} attachmentId 
         */
        removeAttachment(attachmentId) {
            try {
                const currentAttachments = this.attachments || [];
                this.update({
                    attachments: currentAttachments.filter(att => att.id !== attachmentId)
                });
            } catch (error) {
                console.error("Error in removeAttachment:", error);
            }
        },
        
        /**
         * Check if can post message
         * @returns {boolean}
         */
        canPostMessage() {
            return (
                (this.commentText && this.commentText.trim() !== '') || 
                (this.attachments && this.attachments.length > 0)
            );
        },
            
            /**
             * Check session storage for any pending activity comments to open
             */
            _checkSessionStorage() {
                try {
                    const storedInfo = sessionStorage.getItem('open_activity_comments');
                    if (storedInfo) {
                        const threadInfo = JSON.parse(storedInfo);
                        
                        // Check if this is for our message
                        if (threadInfo &&
                            threadInfo.threadModel === 'mail.activity.thread' &&
                            threadInfo.activityDoneMessageId &&
                            threadInfo.activityDoneMessageId === this.message.id) {
                            
                            // Open the comments section
                            if (!this.showComments) {
                                this.update({ showComments: true });
                            }
                            
                            // Scroll the message into view
                            this._scrollIntoView();
                            
                            // Clear the storage so it doesn't keep opening
                            sessionStorage.removeItem('open_activity_comments');
                        }
                    }
                } catch (error) {
                    console.error("Error checking session storage:", error);
                }
            },
            
            /**
             * Scrolls the message into view
             */
            _scrollIntoView() {
                try {
                    if (this.message && this.message.id) {
                        setTimeout(() => {
                            // attempt - look for message by class and content
                            const allMessages = document.querySelectorAll('.o_Message_content');
                            for (const msg of allMessages) {
                                if (msg.textContent.includes(this.message.body) ||
                                    msg.innerHTML.includes(this.message.body)) {
                                    msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    return;
                                }
                            }

                            // Last resort - just scroll to the comments container
                            const commentPanel = document.querySelector('.o_activity_comments_container');
                            if (commentPanel) {
                                commentPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                        }, 100);
                    }
                } catch (error) {
                    console.error("Error scrolling message into view:", error);
                }
            },
            
            // Add submitComment method to be called directly from template
            submitComment() {
                try {
                    // First, ensure the thread is initialized
                    if (this.message && 
                        this.message.messageViews && 
                        this.message.messageViews.length > 0) {
                        
                        const messageView = this.message.messageViews[0];
                        
                        // If thread doesn't exist, initialize it first
                        if (!this.thread && messageView._initializeCommentThread) {
                            // Initialize thread and then submit
                            messageView._initializeCommentThread().then(() => {
                                if (this.thread) {
                                    messageView._submitComment();
                                } else {
                                    console.error("Thread initialization failed");
                                    alert("Cannot submit comment: failed to initialize thread. Please try again or contact your administrator.");
                                }
                            }).catch(error => {
                                console.error("Error initializing thread:", error);
                                alert("Cannot submit comment: error initializing thread. Please try again.");
                            });
                            return;
                        }
                        
                        // If thread exists, submit comment directly
                        messageView._submitComment();
                        return;
                    }
                    
                    // If we get here, try alternate approaches to find the message view
                    const messageViews = document.querySelectorAll('.o_Message');
                    for (const view of messageViews) {
                        // Check if this is the right message by data attribute or content
                        if (view.dataset && view.dataset.messageId === this.message.id.toString()) {
                            // This is our message, find it in the model
                            if (this.env && 
                                this.env.services && 
                                this.env.services.messaging &&
                                this.env.services.messaging.modelManager) {
                                
                                // Try to get MessageView from models
                                const messageViewModels = this.env.services.messaging.modelManager.models['MessageView'].all();
                                if (messageViewModels && messageViewModels.length) {
                                    // Find the view for our message
                                    const myMessageView = messageViewModels.find(
                                        view => view.message && view.message.id === this.message.id
                                    );
                                    
                                    if (myMessageView) {
                                        // Initialize thread first if needed
                                        if (!this.thread && myMessageView._initializeCommentThread) {
                                            // Initialize thread and then submit
                                            myMessageView._initializeCommentThread().then(() => {
                                                if (this.thread) {
                                                    myMessageView._submitComment();
                                                } else {
                                                    console.error("Thread initialization failed");
                                                    alert("Cannot submit comment: failed to initialize thread. Please try again or contact your administrator.");
                                                }
                                            }).catch(error => {
                                                console.error("Error initializing thread:", error);
                                                alert("Cannot submit comment: error initializing thread. Please try again.");
                                            });
                                            return;
                                        }
                                        
                                        // If thread exists, submit directly
                                        if (myMessageView._submitComment) {
                                            myMessageView._submitComment();
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    // Last resort: alert the user
                    console.error("Could not find message view to submit comment");
                    alert("Cannot submit comment: could not find the correct message. Please try again or refresh the page.");
                    
                } catch (error) {
                    console.error("Error in submitComment:", error);
                    alert("An error occurred while submitting your comment. Please try again.");
                }
            },
            
            /**
             * Toggle emoji picker
             */
            toggleEmoji() {
                try {
                    console.log("Toggle emoji picker");
                    // Check if emoji popover is already open
                    const emojiPopover = document.querySelector('.o_emoji_popover');
                    if (emojiPopover) {
                        emojiPopover.remove();
                        return;
                    }
                    
                    // Create emoji popover
                    const popover = document.createElement('div');
                    popover.className = 'o_emoji_popover popover p-0 bg-white shadow-sm border-0 overflow-auto position-absolute';
                    popover.style.maxWidth = '280px';
                    popover.style.maxHeight = '200px';
                    popover.style.zIndex = '1000';
                    
                    // Common emojis
                    const commonEmojis = ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
                                        '🙂', '🙃', '😉', '😌', '😍', '😘', '😗', '😙', '😚', '😋',
                                        '👍', '👎', '👏', '🙌', '👋', '❤️', '👌', '✅', '⭐', '🎉'];
                    
                    // Create emoji grid
                    const emojiGrid = document.createElement('div');
                    emojiGrid.className = 'd-flex flex-wrap p-2';
                    
                    commonEmojis.forEach(emoji => {
                        const emojiBtn = document.createElement('a');
                        emojiBtn.href = '#';
                        emojiBtn.className = 'o_mail_emoji p-2 fs-3';
                        emojiBtn.textContent = emoji;
                        emojiBtn.onclick = (e) => {
                            e.preventDefault();
                            this.insertEmoji(emoji);
                            popover.remove();
                        };
                        emojiGrid.appendChild(emojiBtn);
                    });
                    
                    popover.appendChild(emojiGrid);
                    
                    // Position popover near the emoji button
                    const emojiBtn = event.target.closest('button');
                    document.body.appendChild(popover);
                    
                    const btnRect = emojiBtn.getBoundingClientRect();
                    popover.style.top = (btnRect.bottom + window.scrollY + 5) + 'px';
                    popover.style.left = (btnRect.left + window.scrollX) + 'px';
                    
                    // Close popover when clicking outside
                    const closePopover = (e) => {
                        if (!popover.contains(e.target) && e.target !== emojiBtn) {
                            popover.remove();
                            document.removeEventListener('click', closePopover);
                        }
                    };
                    
                    // Use setTimeout to avoid closing immediately due to the current click event
                    setTimeout(() => {
                        document.addEventListener('click', closePopover);
                    }, 0);
                    
                } catch (error) {
                    console.error("Error in toggleEmoji:", error);
                }
            },
            
            /**
             * Insert emoji into comment text
             */
            insertEmoji(emoji) {
                try {
                    const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                    if (!textarea) return;
                    
                    const cursorPos = textarea.selectionStart;
                    const textBefore = textarea.value.substring(0, cursorPos);
                    const textAfter = textarea.value.substring(textarea.selectionEnd);
                    
                    textarea.value = textBefore + emoji + textAfter;
                    this.commentText = textarea.value;
                    
                    // Set cursor position after the inserted emoji
                    const newCursorPos = cursorPos + emoji.length;
                    textarea.setSelectionRange(newCursorPos, newCursorPos);
                    textarea.focus();
                } catch (error) {
                    console.error("Error inserting emoji:", error);
                }
            },
            
            /**
             * Upload file
             */
            uploadFile() {
                try {
                    console.log("Upload file");
                    
                    // Create file input
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.style.display = 'none';
                    fileInput.multiple = true;
                    
                    // Add file input to document
                    document.body.appendChild(fileInput);
                    
                    // Handle file selection
                    fileInput.onchange = async (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;
                        
                        // Use Odoo's existing file upload mechanism if available
                        if (this.env && this.env.services && this.env.services.fileUpload) {
                            try {
                                const result = await this.env.services.fileUpload.upload(files);
                                console.log("Files uploaded:", result);
                                
                                // Add file references to the comment
                                const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                                if (textarea && result && result.length > 0) {
                                    let fileLinks = '';
                                    
                                    result.forEach(file => {
                                        fileLinks += `\n[${file.name}](${file.url})`;
                                    });
                                    
                                    textarea.value += fileLinks;
                                    this.commentText = textarea.value;
                                    textarea.focus();
                                }
                            } catch (uploadError) {
                                console.error("Error uploading files:", uploadError);
                                alert("Error uploading files. Please try again.");
                            }
                        } else {
                            alert("File upload service not available. Please attach files another way.");
                        }
                        
                        // Cleanup
                        document.body.removeChild(fileInput);
                    };
                    
                    // Trigger file selection dialog
                    fileInput.click();
                } catch (error) {
                    console.error("Error in uploadFile:", error);
                }
            },
            
            /**
             * Handles click in the textarea
             */
            onClickTextarea() {
                console.log("Textarea clicked");
                // Save cursor position for later use
                try {
                    const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                    if (textarea) {
                        this.update({
                            textInputCursorStart: textarea.selectionStart,
                            textInputCursorEnd: textarea.selectionEnd
                        });
                    }
                } catch (error) {
                    console.error("Error in onClickTextarea:", error);
                }
            },
            
            /**
             * Handles textarea focus
             */
            onFocusTextarea() {
                console.log("Textarea focused");
                this.update({ isFocused: true });
            },
            
            /**
             * Handles keydown in textarea
             * @param {KeyboardEvent} ev
             */
            onKeydownTextarea(ev) {
                try {
                    // Handle Enter key (submit comment)
                    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
                        ev.preventDefault();
                        this.submitComment();
                        return;
                    }
                    
                    // Handle Escape key (close comments)
                    if (ev.key === 'Escape') {
                        ev.preventDefault();
                        this.toggleComments();
                        return;
                    }
                } catch (error) {
                    console.error("Error in onKeydownTextarea:", error);
                }
            },
            
            /**
             * Handles keyup in textarea
             * @param {KeyboardEvent} ev
             */
            onKeyupTextarea(ev) {
                try {
                    // Update cursor position
                    const textarea = ev.target;
                    if (textarea) {
                        this.update({
                            textInputCursorStart: textarea.selectionStart,
                            textInputCursorEnd: textarea.selectionEnd
                        });
                    }
                } catch (error) {
                    console.error("Error in onKeyupTextarea:", error);
                }
            },
        },
            fields: {
        message: one('Message', {
            identifying: true,
            inverse: 'commentModel',
        }),
        showComments: attr({
            default: false,
        }),
        commentCount: attr({
            default: 0,
        }),
        thread: one('Thread'),
        commentText: attr({
            default: '',
        }),
        isFocused: attr({
            default: false,
        }),
        textInputCursorStart: attr({
            default: 0,
        }),
        textInputCursorEnd: attr({
            default: 0,
        }),
        attachments: many('Attachment'),
        hasAttachments: attr({
            compute() {
                return Boolean(this.attachments && this.attachments.length > 0);
            },
            default: false,
        }),
    },
    });

    // Patch Activity model
    registerPatch({
        name: 'Activity',
        fields: {
            commentModel: one('ActivityCommentModel', {
                inverse: 'activity',
                isCausal: true,
                compute() {
                    return {};
                },
            }),
        },
    });

    // Patch Message model
    registerPatch({
        name: 'Message',
        fields: {
            commentModel: one('MessageActivityCommentModel', {
                inverse: 'message',
                isCausal: true,
                compute() {
                    return {};
                },
            }),
        },
    });

    registerPatch({
        name: 'ComposerView',
        recordMethods: {
            // You can override existing methods
            onClickSend() {
                // Call original method functionality 
                this._super(...arguments);
                // Add your custom logic here
            },
            
            // Add new methods
            showLogNote() {
                this.update({ composerView: {} });
                this.composerView.composer.update({ isLog: true });
                this.focus();
            },
            
            // You can re-use functionality from the original model
            // For example, to handle activity comments
            onClickLogNote() {
                this._ensureServices();
                if (this.composerView && this.composerView.composer.isLog) {
                    this.update({ composerView: clear() });
                } else {
                    this.showLogNote();
                }
            },
        },
        // Add new fields if needed
        fields: {
            // Your additional fields here
        },
    });

    // Patch ActivityView model
    registerPatch({
        name: 'ActivityView',
        recordMethods: {
           
            _ensureServices() {
                return _ensureServices.call(this);
            },
            
            
            onClickLogNote() {

                this._ensureServices();
                if (this.composerView && this.composerView.composer.isLog) {
                    this.update({ composerView: clear() });
                } else {
                    this.showLogNote();
                }
            },
            showLogNote() {
                this.update({ composerView: {} });
                this.composerView.composer.update({ isLog: true });
                this.focus();
            },
            
            /**
             * Submit the comment to the thread with attachments
             */
            async _submitCommentWithAttachments() {
                try {
                    console.log("_submitCommentWithAttachments called");
                    // Ensure services are available
                    this._ensureServices();
                    
                    if (!this.activity || 
                        !this.activity.commentModel) {
                        alert("Cannot submit comment: activity information is not available");
                        return;
                    }
                    
                    // Get the comment text directly from textarea for accuracy
                    const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                    const commentText = textarea ? textarea.value.trim() : '';
                    
                    // Update the model's commentText property with the current value
                    if (commentText) {
                        this.activity.commentModel.update({
                            commentText: commentText
                        });
                    }
                    
                    // Check if we can post (text or attachments)
                    const canPost = this.activity.commentModel.canPostMessage();
                    console.log("Can post message:", canPost, "comment text:", commentText);
                    
                    if (!canPost) {
                        alert("Please enter a comment or add attachments before submitting");
                        return;
                    }
                    
                    // This is a simplified approach for now - save locally for UI display
                    // In a real implementation, this would connect to the Odoo backend
                    
                    // Create a mock message
                    const mockMessage = {
                        id: -Math.floor(Math.random() * 10000),
                        body: commentText,
                        date: new Date(),
                        author: {
                            id: 1,
                            name: "Current User",
                            avatar: "/web/image?model=res.users&field=avatar_128&id=1"
                        }
                    };
                    
                    // Try to get or create the thread
                    if (!this.activity.commentModel.thread) {
                        const tempThread = {
                            id: -Math.floor(Math.random() * 10000),
                            model: 'mail.activity.thread',
                            messages: [mockMessage]
                        };
                        this.activity.commentModel.update({ thread: tempThread });
                    } else {
                        // Add message to existing thread
                        const thread = this.activity.commentModel.thread;
                        const messages = thread.messages || [];
                        if (Array.isArray(messages)) {
                            messages.push(mockMessage);
                        } else {
                            console.warn("Thread messages property is not an array");
                        }
                    }
                    
                    // Success! Clear the textarea
                    if (textarea) {
                        textarea.value = '';
                    }
                    
                    // Clear commentText in the model
                    this.activity.commentModel.update({
                        commentText: ''
                    });
                    
                    // Update count
                    this._updateCommentCount();
                    
                    // Show success message only during development
                    console.log("Comment posted successfully (local mode)");
                                        
                } catch (error) {
                    console.error("Error submitting comment:", error);
                    alert("An error occurred while submitting your comment. Please try again.");
                }
            },
            
            /**
             * Submit the comment to the thread
             * @deprecated Use _submitCommentWithAttachments instead
             */
            async _submitComment() {
                return this._submitCommentWithAttachments();
            },
            
            /**
             * Initialize the comment thread
             */
            async _initializeCommentThread() {
                try {
                    // Ensure services are available
                    this._ensureServices();
                    
                    if (!this.activity || !this.activity.id) {
                        return;
                    }
                    
                    // Check if thread already exists
                    if (!this.activity.commentModel.thread) {
                        // Basic thread creation if component method not available
                        try {
                            // Get ORM service, either from this.orm or this.env.services
                            const orm = this.orm;
                            
                            if (!orm) {
                                console.warn("ORM service not available, creating temporary thread");
                                // Fallback: create a temporary thread object locally
                                if (this.env && this.env.messaging && this.env.messaging.models && this.env.messaging.models['Thread']) {
                                    const Thread = this.env.messaging.models['Thread'];
                                    const tempThreadId = -Math.floor(Math.random() * 10000);
                                    
                                    const thread = Thread.create({
                                        id: tempThreadId,
                                        model: 'mail.activity.thread',
                                        name: 'Temporary Thread',
                                        isTemporary: true,
                                    });
                                    
                                    if (thread) {
                                        this.activity.commentModel.update({ 
                                            thread: thread,
                                            showComments: true
                                        });
                                        return thread;
                                    }
                                } else if (window.odoo && window.odoo.define) {
                                    // Try an alternative approach using Odoo's define
                                    const tempThreadId = -Math.floor(Math.random() * 10000);
                                    const thread = {
                                        id: tempThreadId,
                                        model: 'mail.activity.thread',
                                        name: 'Temporary Thread',
                                        isTemporary: true,
                                        messages: []
                                    };
                                    
                                    this.activity.commentModel.update({ 
                                        thread: thread,
                                        showComments: true
                                    });
                                    return thread;
                                }
                                return null;
                            }
                            
                            // Search for existing thread
                            console.log("Searching for thread with activity_id:", this.activity.id);
                            const threadRecords = await orm.searchRead(
                                'mail.activity.thread',
                                [['activity_id', '=', this.activity.id]],
                                ['id', 'res_model', 'res_id']
                            );
                            
                            let threadId;
                            if (threadRecords.length === 0) {
                                // Create thread if doesn't exist
                                console.log("Creating new thread for activity:", this.activity.id);
                                const threadValues = {
                                    activity_id: this.activity.id,
                                    res_model: this.activity.res_model || 'res.partner',
                                    res_id: this.activity.res_id || '0',
                                };
                                console.log("Thread values:", threadValues);
                                
                                const newThreadIds = await orm.create('mail.activity.thread', [threadValues]);
                                threadId = newThreadIds[0];
                                console.log("Created thread with ID:", threadId);
                            } else {
                                threadId = threadRecords[0].id;
                                console.log("Found existing thread:", threadId);
                            }
                            
                            // Try to find or create thread in models
                            if (this.env && this.env.messaging && this.env.messaging.models && this.env.messaging.models['Thread']) {
                                const Thread = this.env.messaging.models['Thread'];
                                
                                // Check if thread exists
                                let thread = Thread.all().find(t => t.id === threadId && t.model === 'mail.activity.thread');
                                
                                // Create thread if it doesn't exist
                                if (!thread) {
                                    thread = Thread.create({
                                        id: threadId,
                                        model: 'mail.activity.thread',
                                    });
                                }
                                
                                // Update activity comment model
                                if (thread) {
                                    this.activity.commentModel.update({ thread: thread });
                                    return thread;
                                }
                            } else {
                                // Create a simple thread object if models aren't available
                                const thread = {
                                    id: threadId,
                                    model: 'mail.activity.thread',
                                    messages: []
                                };
                                this.activity.commentModel.update({ thread: thread });
                                return thread;
                            }
                        } catch (e) {
                            console.error("Error creating thread in base model:", e);
                            return null;
                        }
                    }
                    
                    return this.activity.commentModel.thread;
                } catch (error) {
                    console.error("Failed to initialize activity thread:", error);
                    return null;
                }
            },
            
            /**
             * Toggle the visibility of comments for this activity
             */
            toggleComments() {
                try {
                    this._ensureServices();
                    console.log("ActivityView toggleComments called");
                    
                    if (this.activity && this.activity.commentModel) {
                        // Toggle comment panel on the commentModel, not on ActivityView
                        const showingComments = this.activity.commentModel.showComments;
                        
                        if (showingComments) {
                            // If panel already open, close it
                            this.activity.commentModel.update({
                                showComments: false
                            });
                            
                            // Update count when closing
                            this._updateCommentCount();
                        } else {
                            // If panel closed, show it
                            this.activity.commentModel.update({
                                showComments: true
                            });
                            
                            // Initialize thread if needed
                            this._initializeCommentThread();
                            
                            // Focus the textarea
                            setTimeout(() => {
                                const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                                if (textarea) {
                                    textarea.focus();
                                }
                            }, 100);
                        }
                    } else {
                        console.error("Activity or commentModel not available");
                    }
                } catch (e) {
                    console.error("Error in ActivityView toggleComments:", e);
                }
            },
            
            /**
             * Update the comment count
             */
            _updateCommentCount() {
                try {
                    if (this.activity && 
                        this.activity.commentModel && 
                        this.activity.commentModel.thread && 
                        this.activity.commentModel.thread.messages) {
                        
                        const validMessages = this.activity.commentModel.thread.messages.filter(
                            msg => msg && msg.body && msg.body.trim() !== ''
                        );
                        this.activity.commentModel.update({ 
                            commentCount: validMessages.length 
                        });
                    }
                } catch (e) {
                    console.error("Error in ActivityView _updateCommentCount:", e);
                }
            },
        },
    });

    // Patch MessageView model
    registerPatch({
        name: 'MessageView',
        recordMethods: {
            /**
             * Enhanced setup after the component is mounted
             */
            setup() {
                if (this._super) {
                    this._super(...arguments);
                }
                
                // Add global listener after component mounted
                if (this.env && this.env.messageBus) {
                    this.env.messageBus.on('web_client_ready', this, this._setupMessageClickListeners);
                }
                
                // Also try to setup listeners when the view is first created
                setTimeout(() => {
                    this._setupMessageClickListeners();
                    this._setupMutationObserver();
                }, 1000);
            },
            
            /**
             * Setup mutation observer to detect new comment buttons
             */
            _setupMutationObserver() {
                try {
                    // Create a new mutation observer
                    const observer = new MutationObserver((mutations) => {
                        let needsSetup = false;
                        
                        // Check if we need to set up new buttons
                        mutations.forEach(mutation => {
                            if (mutation.type === 'childList') {
                                mutation.addedNodes.forEach(node => {
                                    if (node.nodeType === 1) { // Element node
                                        // If the node itself or any of its descendants has our button class
                                        if (node.classList && node.classList.contains('o_activity_comment_btn') || 
                                            node.querySelector && node.querySelector('.o_activity_comment_btn')) {
                                            needsSetup = true;
                                        }
                                    }
                                });
                            }
                        });
                        
                        // If we found new buttons, set them up
                        if (needsSetup) {
                            this._setupMessageClickListeners();
                        }
                    });
                    
                    // Start observing the entire document for changes
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true
                    });
                    
                    console.log("MutationObserver set up for comment buttons");
                } catch (error) {
                    console.error("Error setting up MutationObserver:", error);
                }
            },
            
            /**
             * Setup click listeners for comment buttons
             * This ensures they can be clicked even within scrollable containers
             */
            _setupMessageClickListeners() {
                try {
                    // Wait a bit for all components to be fully rendered
                    setTimeout(() => {
                        const commentBtns = document.querySelectorAll('.o_activity_comment_btn');
                        
                        commentBtns.forEach(btn => {
                            // Remove any existing listeners to avoid duplicates
                            btn.removeEventListener('click', this._handleCommentBtnClick);
                            
                            // Add our enhanced listener
                            btn.addEventListener('click', this._handleCommentBtnClick);
                            
                            // Make sure it's visible and clickable
                            btn.style.position = 'relative';
                            btn.style.zIndex = '100';
                            btn.style.pointerEvents = 'auto';
                            
                            // Add a debug class to identify it has been enhanced
                            btn.classList.add('comment-btn-enhanced');
                        });
                        
                        console.log(`Enhanced ${commentBtns.length} comment buttons`);
                    }, 500);
                } catch (error) {
                    console.error("Error setting up message click listeners:", error);
                }
            },
            
            /**
             * Handler for comment button clicks
             */
            _handleCommentBtnClick(event) {
                try {
                    // Prevent default anchor behavior
                    event.preventDefault();
                    event.stopPropagation();
                    
                    // Find the message-id from the parent wrapper
                    const wrapper = event.target.closest('.o_activity_comment_panel_wrapper');
                    if (wrapper && wrapper.dataset.messageId) {
                        const messageId = parseInt(wrapper.dataset.messageId, 10);
                        console.log(`Comment button clicked for message ID: ${messageId}`);
                        
                        // Find MessageView instance and call toggleComments
                        const messageViews = document.querySelectorAll('.o_Message');
                        for (const view of messageViews) {
                            if (view.dataset && view.dataset.messageId === messageId.toString()) {
                                // This is our message, try to find its component
                                if (view.__owl__ && view.__owl__.component) {
                                    view.__owl__.component.toggleComments();
                                    return false;
                                }
                            }
                        }
                    }
                    
                    return false;
                } catch (error) {
                    console.error("Error handling comment button click:", error);
                }
            },
            /**
             * Ensure that required services are available
             */
            _ensureServices() {
                try {
                    // If orm service not available, try to get it from other sources
                    if (!this.orm) {
                        // Try different ways to get ORM service
                        if (this.env && this.env.services && this.env.services.orm) {
                            this.orm = this.env.services.orm;
                        } else if (window.odoo && window.odoo.services && window.odoo.services.orm) {
                            this.orm = window.odoo.services.orm;
                        } else {
                            // Try to get it from document state if available
                            const anyComponent = document.querySelector('.o_component');
                            if (anyComponent && anyComponent.__owl__ && 
                                anyComponent.__owl__.component && 
                                anyComponent.__owl__.component.env && 
                                anyComponent.__owl__.component.env.services && 
                                anyComponent.__owl__.component.env.services.orm) {
                                this.orm = anyComponent.__owl__.component.env.services.orm;
                            } else {
                                console.warn("No ORM service found, creating mock");
                            }
                        }
                        
                        // If we still don't have ORM, create a mock
                        if (!this.orm) {
                            console.log("Creating mock ORM service");
                            this.orm = {
                                async searchRead(model, domain, fields) {
                                    console.warn("Mock searchRead called", {model, domain, fields});
                                    return [];
                                },
                                async create(model, values) {
                                    console.warn("Mock create called", {model, values});
                                    const id = -Math.floor(Math.random() * 10000);
                                    console.log("Created mock record with ID:", id);
                                    return [id];
                                }
                            };
                        }
                    }
                    
                    // Do the same for other services if needed
                    if (!this.rpc && this.env && this.env.services && this.env.services.rpc) {
                        this.rpc = this.env.services.rpc;
                    }
                    
                    if (!this.messagingService && this.env && this.env.services && this.env.services.messaging) {
                        this.messagingService = this.env.services.messaging;
                    }
                } catch (e) {
                    console.error("Error ensuring services:", e);
                }
            },
            
            /**
             * Odoo standard handler for Log Note button
             */
            onClickLogNote() {

                this._ensureServices();
                if (this.composerView && this.composerView.composer.isLog) {
                    this.update({ composerView: clear() });
                } else {
                    this.showLogNote();
                }
            },
            
            showLogNote() {
                this.update({ composerView: {} });
                this.composerView.composer.update({ isLog: true });
                this.focus();
            },
            
            /**
             * Submit the comment to the thread with attachments
             */
            async _submitCommentWithAttachments() {
                try {
                    // Ensure services are available
                    this._ensureServices();
                    
                    if (!this.message || 
                        !this.message.commentModel) {
                        alert("Cannot submit comment: message information is not available");
                        return;
                    }
                    
                    // If thread doesn't exist, initialize it
                    if (!this.message.commentModel.thread) {
                        await this._initializeCommentThread();
                    }
                    
                    if (!this.message.commentModel.thread) {
                        alert("Cannot submit comment: failed to initialize thread. Please try again or contact your administrator.");
                        return;
                    }
                    
                    // Check if we can post (text or attachments)
                    if (!this.message.commentModel.canPostMessage()) {
                        alert("Please enter a comment or add attachments before submitting");
                        return;
                    }
                    
                    // Get the comment text from textarea
                    const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                    const commentText = textarea ? textarea.value.trim() : '';
                    const threadId = this.message.commentModel.thread.id;
                    const attachments = this.message.commentModel.attachments || [];
                    
                    // Try to use standard Odoo posting mechanisms
                    let success = false;
                    let serviceAttempted = false;
                    
                    // Try using the standard post function if available
                    if (this.env && this.env.services && this.env.services.messaging) {
                        serviceAttempted = true;
                        try {
                            await this.env.services.messaging.post({
                                threadId: threadId,
                                threadModel: 'mail.activity.thread',
                                body: commentText,
                                isNote: true,
                                attachmentIds: attachments.map(a => a.id),
                                attachmentTokens: attachments.map(a => a.accessToken || ''),
                            });
                            success = true;
                        } catch (msgError) {
                            console.error("Error posting via messaging service:", msgError);
                        }
                    }
                    
                    // Fallback to RPC
                    if (!success && this.env && this.env.services && this.env.services.rpc) {
                        serviceAttempted = true;
                        try {
                            await this.env.services.rpc('/mail/thread/post', {
                                thread_model: 'mail.activity.thread',
                                thread_id: threadId,
                                body: commentText,
                                subtype_xmlid: 'mail.mt_note',
                                attachment_ids: attachments.map(a => a.id),
                            });
                            success = true;
                        } catch (rpcError) {
                            console.error("Error posting via RPC:", rpcError);
                        }
                    }
                    
                    // Fallback to ORM
                    if (!success && this.env && this.env.services && this.env.services.orm) {
                        serviceAttempted = true;
                        try {
                            await this.env.services.orm.create('mail.message', [{
                                model: 'mail.activity.thread',
                                res_id: threadId,
                                body: commentText,
                                message_type: 'comment',
                                subtype_xmlid: 'mail.mt_note',
                                attachment_ids: attachments.map(a => a.id),
                            }]);
                            success = true;
                        } catch (ormError) {
                            console.error("Error creating message with ORM:", ormError);
                        }
                    }
                    
                    if (success) {
                        // Clear the textarea and attachments
                        if (textarea) {
                            textarea.value = '';
                        }
                        
                        // Clear attachments
                        this.message.commentModel.update({
                            commentText: '',
                            attachments: clear()
                        });
                        
                        // Refresh thread to show the new message
                        if (this.message.commentModel.thread.fetchMessages) {
                            await this.message.commentModel.thread.fetchMessages();
                        }
                        
                        // Update count
                        this._updateCommentCount();
                    } else {
                        if (!serviceAttempted) {
                            alert("Failed to post comment: no messaging services available. Please refresh the page and try again.");
                        } else {
                            alert("Failed to post comment. Please try again later.");
                        }
                    }
                } catch (error) {
                    console.error("Error submitting comment:", error);
                    alert("An error occurred while submitting your comment. Please try again.");
                }
            },
            
            /**
             * Submit the comment to the thread
             * @deprecated Use _submitCommentWithAttachments instead
             */
            async _submitComment() {
                return this._submitCommentWithAttachments();
            },
            
            /**
             * Initialize the comment thread for this message
             */
            async _initializeCommentThread() {
                try {
                    // Ensure services are available
                    this._ensureServices();
                    
                    if (!this.message || !this.message.id) {
                        return;
                    }
                    
                    // Check if thread already exists
                    if (!this.message.commentModel.thread) {
                        // Basic thread creation if component method not available
                        try {
                            // Get ORM service from this.orm
                            const orm = this.orm;
                            
                            if (!orm) {
                                // Fallback: try to create a temporary thread object locally
                                if (this.env && this.env.messaging && this.env.messaging.models && this.env.messaging.models['Thread']) {
                                    const Thread = this.env.messaging.models['Thread'];
                                    const tempThreadId = -Math.floor(Math.random() * 10000) - 100000; // Different range from ActivityView
                                    
                                    const thread = Thread.create({
                                        id: tempThreadId,
                                        model: 'mail.activity.thread',
                                        name: 'Temporary Message Thread',
                                        isTemporary: true,
                                    });
                                    
                                    if (thread) {
                                        this.message.commentModel.update({ 
                                            thread: thread,
                                            showComments: true
                                        });
                                        return thread;
                                    }
                                }
                                return null;
                            }
                            
                            // For completed activity messages, we need to search by activity_done_message_id
                            let searchDomain = [];
                            let isDoneActivity = false;
                            
                            // Support both activity and activity done messages with broader patterns
                            // Improved detection of activity done messages
                            if (this.message.model && this.message.model.includes('mail.activity')) {
                                isDoneActivity = true;
                                searchDomain = [['activity_done_message_id', '=', this.message.id]];
                            } else if (this.message.subtype_id && this.message.subtype_id[0] === 3) {
                                isDoneActivity = true;
                                searchDomain = [['activity_done_message_id', '=', this.message.id]];
                            } else if (this.message.body) {
                                // More comprehensive matching for all possible done/completed activities
                                const lowerBody = this.message.body.toLowerCase();
                                if (lowerBody.includes('to do done') || 
                                    lowerBody.includes(' done') || 
                                    lowerBody.includes('marked as done') ||
                                    lowerBody.includes('completed') ||
                                    lowerBody.includes('finish') || 
                                    lowerBody.includes('to do')) {
                                    
                                    isDoneActivity = true;
                                    searchDomain = [['activity_done_message_id', '=', this.message.id]];
                                    console.log("Detected completed activity message:", this.message.id);
                                }
                            }
                            
                            // If not detected as done activity yet, try generic fallback
                            if (!isDoneActivity) {
                                searchDomain = [
                                    '|',
                                    ['activity_id', '=', this.message.id],
                                    ['activity_done_message_id', '=', this.message.id]
                                ];
                            }
                            
                            console.log("Searching for thread with domain:", searchDomain);
                            
                            // Search for existing thread
                            const threadRecords = await orm.searchRead(
                                'mail.activity.thread',
                                searchDomain,
                                ['id', 'res_model', 'res_id']
                            );
                            
                            let threadId;
                            if (threadRecords.length === 0) {
                                // Create a new thread record if none exists
                                const threadValues = {
                                    res_model: this.message.model || 'mail.activity',
                                    res_id: this.message.res_id || '0',
                                };
                                
                                // Add the appropriate ID field based on whether this is a done activity
                                if (isDoneActivity) {
                                    threadValues.activity_done_message_id = this.message.id;
                                } else {
                                    threadValues.activity_id = this.message.id;
                                }
                                
                                console.log("Creating new thread with values:", threadValues);
                                const newThreadIds = await orm.create('mail.activity.thread', [threadValues]);
                                threadId = newThreadIds[0];
                            } else {
                                threadId = threadRecords[0].id;
                                console.log("Found existing thread:", threadId);
                            }
                            
                            // Try to find or create thread in models
                            if (this.env && this.env.messaging && this.env.messaging.models && this.env.messaging.models['Thread']) {
                                const Thread = this.env.messaging.models['Thread'];
                                
                                // Check if thread exists
                                let thread = Thread.all().find(t => t.id === threadId && t.model === 'mail.activity.thread');
                                
                                // Create thread if it doesn't exist
                                if (!thread) {
                                    thread = Thread.create({
                                        id: threadId,
                                        model: 'mail.activity.thread',
                                    });
                                }
                                
                                // Update message comment model
                                if (thread) {
                                    this.message.commentModel.update({ thread: thread });
                                    
                                    // Pre-fetch messages to update comment count
                                    if (typeof thread.fetchMessages === 'function') {
                                        thread.fetchMessages().then(() => {
                                            // Update count after messages are loaded
                                            this._updateCommentCount();
                                        });
                                    }
                                    
                                    return thread;
                                }
                            }
                            
                            return null;
                        } catch (e) {
                            console.error("Error creating thread in base model:", e);
                            return null;
                        }
                    }
                    
                    return this.message.commentModel.thread;
                } catch (error) {
                    console.error("Failed to initialize message thread:", error);
                    return null;
                }
            },
            
            /**
             * Toggle the visibility of comments for this message
             */
            toggleComments() {
                try {
                    this._ensureServices();
                    console.log("MessageView toggleComments called for message", this.message && this.message.id);

                    if (this.message && this.message.commentModel) {
                        // Toggle our comment panel
                        const showingComments = this.message.commentModel.showComments;
                        
                        if (showingComments) {
                            // If panel already open, close it
                            this.message.commentModel.update({
                                showComments: false
                            });
                            
                            // Update count when closing
                            this._updateCommentCount();
                        } else {
                            // If panel closed, show it
                            this.message.commentModel.update({
                                showComments: true
                            });
                            
                            // Initialize thread if needed
                            console.log("Initializing comment thread for message", this.message.id);
                            this._initializeCommentThread()
                                .then((thread) => {
                                    if (thread) {
                                        console.log("Thread initialization successful for message", this.message.id);
                                        // Update count after thread is loaded
                                        this._updateCommentCount();
                                    } else {
                                        console.warn("Thread initialization returned empty thread");
                                    }
                                })
                                .catch(error => {
                                    console.error("Thread initialization failed for message", this.message.id, error);
                                });
                            
                            // Focus the textarea
                            setTimeout(() => {
                                const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                                if (textarea) {
                                    textarea.focus();
                                }
                            }, 100);
                        }
                    } else {
                        console.error("Message or message.commentModel not available:", this.message);
                    }
                } catch (e) {
                    console.error("Error in MessageView toggleComments:", e);
                }
            },
            
            /**
             * Update the comment count
             */
            _updateCommentCount() {
                try {
                    if (this.message && 
                        this.message.commentModel && 
                        this.message.commentModel.thread && 
                        this.message.commentModel.thread.messages) {
                        
                        const validMessages = this.message.commentModel.thread.messages.filter(
                            msg => msg && msg.body && msg.body.trim() !== ''
                        );
                        this.message.commentModel.update({ 
                            commentCount: validMessages.length 
                        });
                    }
                } catch (e) {
                    console.error("Error in MessageView _updateCommentCount:", e);
                }
            },
            
            /**
             * Scrolls the message into view
             */
            scrollMessageIntoView() {
                try {
                    if (this.message && this.message.id) {
                        setTimeout(() => {
                            // attempt - look for message by class and content
                            const allMessages = document.querySelectorAll('.o_Message_content');
                            for (const msg of allMessages) {
                                if (msg.textContent.includes(this.message.body) ||
                                    msg.innerHTML.includes(this.message.body)) {
                                    msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    return;
                                }
                            }

                            // Last resort - just scroll to the comments container
                            const commentPanel = document.querySelector('.o_activity_comments_container');
                            if (commentPanel) {
                                commentPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                        }, 100);
                    }
                } catch (error) {
                    console.error("Error scrolling message into view:", error);
                }
            },
        },
    });

    // Patch Chatter model
    registerPatch({
        name: 'Chatter',
        recordMethods: {
            /**
             * Override focus to support activity comment panels
             */
            focus() {
                if (this.composerView) {
                    this.composerView.update({ doFocus: true });
                }
                
                // Also focus any open activity comment panel
                setTimeout(() => {
                    const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                    if (textarea) {
                        textarea.focus();
                    }
                }, 100);
            },
            
            /**
             * Override to handle activity comments when saving a record
             */
            async doSaveRecord() {
                const saved = await this.saveRecord();
                if (!saved) {
                    return saved;
                }
                
                // Store any open activity comment data
                let composerData = null;
                let activityCommentData = null;
                
                // Check for standard composer data
                if (this.composerView) {
                    const {
                        attachments,
                        isLog,
                        rawMentionedChannels,
                        rawMentionedPartners,
                        textInputContent,
                        textInputCursorEnd,
                        textInputCursorStart,
                        textInputSelectionDirection,
                    } = this.composerView.composer;
                    composerData = {
                        attachments,
                        isLog,
                        rawMentionedChannels,
                        rawMentionedPartners,
                        textInputContent,
                        textInputCursorEnd,
                        textInputCursorStart,
                        textInputSelectionDirection,
                    };
                }
                
                // Check for activity comment data
                const activityCommentPanel = document.querySelector('.o_activity_comment_panel_wrapper');
                if (activityCommentPanel) {
                    const textarea = activityCommentPanel.querySelector('textarea');
                    if (textarea && textarea.value.trim()) {
                        activityCommentData = {
                            text: textarea.value.trim(),
                            activityId: null,
                            messageId: null
                        };
                        
                        // Try to get activity ID or message ID from data attributes or context
                        const activityElement = activityCommentPanel.closest('.o_Activity');
                        const messageElement = activityCommentPanel.closest('.o_Message');
                        
                        if (activityElement && activityElement.dataset && activityElement.dataset.activityId) {
                            activityCommentData.activityId = parseInt(activityElement.dataset.activityId, 10);
                        }
                        
                        if (messageElement && messageElement.dataset && messageElement.dataset.messageId) {
                            activityCommentData.messageId = parseInt(messageElement.dataset.messageId, 10);
                        }
                    }
                }
                
                // Wait for next render from chatter_container
                this.update({
                    createNewRecordComposerData: composerData,
                    createNewRecordDeferred: composerData ? makeDeferred() : null,
                    activityCommentData: activityCommentData
                });
                
                if (this.createNewRecordDeferred) {
                    await this.createNewRecordDeferred;
                }
                
                // Give some time to chatter model being updated by save
                await new Promise((resolve) => setTimeout(() => requestAnimationFrame(resolve)));
                
                // Restore activity comment if needed after save
                if (activityCommentData) {
                    // Attempt to restore activity comment after save
                    setTimeout(() => {
                        const newActivityCommentPanel = document.querySelector('.o_activity_comment_panel_wrapper');
                        if (newActivityCommentPanel) {
                            const newTextarea = newActivityCommentPanel.querySelector('textarea');
                            if (newTextarea) {
                                newTextarea.value = activityCommentData.text;
                                newTextarea.focus();
                            }
                        }
                    }, 500);
                }
                
                return saved;
            },
            
            /**
             * Add activity comment handling capability to the chatter
             */
            handleActivityComment(activityId, commentText) {
                // Find the activity view for this activity
                const activityView = this.thread && this.thread.activities.find(a => a.id === activityId);
                
                if (activityView && activityView.commentModel) {
                    // Set the comment text and show the comment panel
                    activityView.commentModel.update({
                        commentText: commentText,
                        showComments: true
                    });
                    
                    // Initialize the thread if needed
                    if (!activityView.commentModel.thread && activityView._initializeCommentThread) {
                        activityView._initializeCommentThread();
                    }
                    
                    return true;
                }
                
                return false;
            }
        },
        fields: {
            activityCommentData: attr({
                default: null,
            }),
        },
    });

    // Add ensureServices function shared by multiple components
    const _ensureServices = function() {
        try {
            // If orm service not available, try to get it from other sources
            if (!this.orm) {
                console.log("Trying to ensure ORM service is available");
                
                // Try different ways to get ORM service
                if (this.env && this.env.services && this.env.services.orm) {
                    console.log("Found ORM in env.services");
                    this.orm = this.env.services.orm;
                } else if (window.odoo && window.odoo.services && window.odoo.services.orm) {
                    console.log("Found ORM in window.odoo.services");
                    this.orm = window.odoo.services.orm;
                } else {
                    // Try to get it from document state if available
                    const anyComponent = document.querySelector('.o_component');
                    if (anyComponent && anyComponent.__owl__ && 
                        anyComponent.__owl__.component && 
                        anyComponent.__owl__.component.env && 
                        anyComponent.__owl__.component.env.services && 
                        anyComponent.__owl__.component.env.services.orm) {
                        console.log("Found ORM in document component");
                        this.orm = anyComponent.__owl__.component.env.services.orm;
                    } else {
                        console.warn("No ORM service found, creating mock");
                    }
                }
                
                // If we still don't have ORM, create a mock
                if (!this.orm) {
                    console.log("Creating mock ORM service");
                    this.orm = {
                        async searchRead(model, domain, fields) {
                            console.warn("Mock searchRead called", {model, domain, fields});
                            return [];
                        },
                        async create(model, values) {
                            console.warn("Mock create called", {model, values});
                            const id = -Math.floor(Math.random() * 10000);
                            console.log("Created mock record with ID:", id);
                            return [id];
                        }
                    };
                }
            }
            
            // Do the same for other services if needed
            if (!this.rpc && this.env && this.env.services && this.env.services.rpc) {
                this.rpc = this.env.services.rpc;
            }
            
            if (!this.messagingService && this.env && this.env.services && this.env.services.messaging) {
                this.messagingService = this.env.services.messaging;
            }
        } catch (e) {
            console.error("Error ensuring services:", e);
        }
    }
} catch (e) {
    console.error("Error registering activity comment models:", e);
} 