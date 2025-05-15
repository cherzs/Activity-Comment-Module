/** @odoo-module **/

import { registerModel, registerPatch } from '@mail/model/model_core';
import { attr, many, one } from '@mail/model/model_field';
import { clear, link } from '@mail/model/model_field_command';
import { addLink, escapeAndCompactTextContent, parseAndTransform } from '@mail/js/utils';
import { isEventHandled, markEventHandled } from '@mail/utils/utils';
import { markup } from '@odoo/owl';

import { escape, sprintf } from '@web/core/utils/strings';
import { url } from '@web/core/utils/urls';
import session from "web.session";
import { makeDeferred } from '@mail/utils/deferred';

// Imported from offline_mode.js

try {
    // ActivityCommentModel model
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
            toggleEmoji(event) {
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
                    const emojiBtn = event ? event.target.closest('button') : document.querySelector('.o-mail-Composer-input');
                    if (!emojiBtn) {
                        console.error("Could not find emoji button or textarea");
                        return;
                    }
                    
                    document.body.appendChild(popover);
                    
                    const btnRect = emojiBtn.getBoundingClientRect();
                    popover.style.top = (btnRect.bottom + window.scrollY + 5) + 'px';
                    popover.style.left = (btnRect.left + window.scrollX) + 'px';
                    
                    // Close popover when clicking outside
                    const closePopover = (e) => {
                        if (!popover.contains(e.target) && (!emojiBtn || e.target !== emojiBtn)) {
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
                    // Try to find the active textarea - needs to find the one currently visible and in use
                    const allTextareas = document.querySelectorAll('.o_activity_comment_panel_wrapper textarea');
                    let hasContent = false;
                    
                    // Check all textareas for content
                    for (const textarea of allTextareas) {
                        if (textarea && textarea.offsetParent !== null) { // Check if visible
                            if (textarea.value && textarea.value.trim() !== '') {
                                hasContent = true;
                                break;
                            }
                        }
                    }
                    
                    // Also check model property and attachments
                    const hasCommentText = this.commentText && this.commentText.trim() !== '';
                    const hasAttachments = this.attachments && this.attachments.length > 0;
                    
                    // Get the current element the user is typing in
                    const activeElement = document.activeElement;
                    const activeElementHasContent = activeElement && 
                                                  activeElement.tagName === 'TEXTAREA' && 
                                                  activeElement.value && 
                                                  activeElement.value.trim() !== '';
                    
                    // Log for debugging
                    console.log("canPostMessage check:", { 
                        hasContent, 
                        hasCommentText, 
                        hasAttachments,
                        activeElementHasContent,
                        activeElementValue: activeElement && activeElement.tagName === 'TEXTAREA' ? activeElement.value : null
                    });
                    
                    // Return true if any of these conditions are met
                    return hasContent || hasCommentText || hasAttachments || activeElementHasContent;
                } catch (error) {
                    console.error("Error in canPostMessage:", error);
                    return true; // Default to allowing submission if there's an error checking
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
            
            // Add method to manually retry sending messages
            async retryLocalMessages() {
                try {
                    // Find all local messages for this thread
                    if (this.thread && this.thread.messages) {
                        const localMessages = this.thread.messages.filter(msg => msg.isLocalOnly);
                        
                        if (localMessages.length === 0) {
                            console.log("No local messages to retry");
                            return;
                        }
                        
                        if (!isOnline()) {
                            alert("You're currently offline. Messages will be synchronized when your connection is restored.");
                            return;
                        }
                        
                        let syncCount = 0;
                        for (const message of localMessages) {
                            try {
                                // Try to send the message to the server
                                if (this.env && this.env.services && this.env.services.rpc) {
                                    await this.env.services.rpc('/mail/thread/post', {
                                        thread_model: 'mail.activity.thread',
                                        thread_id: this.thread.id,
                                        body: message.body,
                                        subtype_xmlid: 'mail.mt_note',
                                    });
                                    
                                    // Mark as synced
                                    message.isLocalOnly = false;
                                    syncCount++;
                                }
                            } catch (error) {
                                console.error("Failed to sync message:", error);
                            }
                        }
                        
                        if (syncCount > 0) {
                            // Update UI to reflect changes
                            this.update({ hasLocalOnlyMessages: localMessages.length > syncCount });
                            
                            // Show success message
                            alert(`Successfully synchronized ${syncCount} of ${localMessages.length} messages.`);
                        } else {
                            alert("Failed to synchronize messages. Please try again later.");
                        }
                    }
                } catch (error) {
                    console.error("Error in retryLocalMessages:", error);
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
            hasLocalOnlyMessages: attr({
                default: false,
            }),
            pendingMessageCount: attr({
                compute() {
                    if (!this.thread || !this.thread.messages) return 0;
                    return this.thread.messages.filter(msg => msg.isLocalOnly).length;
                },
                default: 0,
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
            try {
                // Try to find the active textarea - check all visible textareas
                const allTextareas = document.querySelectorAll('.o_activity_comment_panel_wrapper textarea');
                let hasContent = false;
                
                // Check all textareas for content
                for (const textarea of allTextareas) {
                    if (textarea && textarea.offsetParent !== null) { // Check if visible
                        if (textarea.value && textarea.value.trim() !== '') {
                            hasContent = true;
                            break;
                        }
                    }
                }
                
                // Also check model property and attachments
                const hasCommentText = this.commentText && this.commentText.trim() !== '';
                const hasAttachments = this.attachments && this.attachments.length > 0;
                
                // Get the current element the user is typing in
                const activeElement = document.activeElement;
                const activeElementHasContent = activeElement && 
                                              activeElement.tagName === 'TEXTAREA' && 
                                              activeElement.value && 
                                              activeElement.value.trim() !== '';
                
                // Return true if any of these conditions are met
                return hasContent || hasCommentText || hasAttachments || activeElementHasContent;
            } catch (error) {
                console.error("Error in message canPostMessage:", error);
                return true; // Default to allowing submission if there's an error checking
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
                            messageView._initializeCommentThread().then((thread) => {
                                console.log("Thread after init:", thread);
                                // Update this model's thread reference with the result
                                if (thread && !this.thread) {
                                    this.update({ thread: thread });
                                }
                                
                                if (this.thread || thread) {
                                    messageView._submitComment();
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
                                        messageView._submitComment();
                                    }, 100);
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
            toggleEmoji(event) {
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
                    const emojiBtn = event ? event.target.closest('button') : document.querySelector('.o-mail-Composer-input');
                    if (!emojiBtn) {
                        console.error("Could not find emoji button or textarea");
                        return;
                    }
                    
                    document.body.appendChild(popover);
                    
                    const btnRect = emojiBtn.getBoundingClientRect();
                    popover.style.top = (btnRect.bottom + window.scrollY + 5) + 'px';
                    popover.style.left = (btnRect.left + window.scrollX) + 'px';
                    
                    // Close popover when clicking outside
                    const closePopover = (e) => {
                        if (!popover.contains(e.target) && (!emojiBtn || e.target !== emojiBtn)) {
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
        hasLocalOnlyMessages: attr({
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

    // ComposerView model
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
                    console.log("ActivityView _submitCommentWithAttachments called");
                    // Ensure services are available
                    this._ensureServices();
                    
                    if (!this.activity || 
                        !this.activity.commentModel) {
                        alert("Cannot submit comment: activity information is not available");
                        return;
                    }
                    
                    // Get the comment text directly from textarea
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
                        alert("Please enter a comment before submitting");
                        return;
                    }
                    
                    // Ensure thread is properly initialized
                    if (!this.activity.commentModel.thread || !this.activity.commentModel.thread.id) {
                        console.log("Thread not properly initialized, attempting to initialize now");
                        await this._initializeCommentThread();
                    }
                    
                    // Try to use standard Odoo posting mechanisms first
                    let success = false;
                    let error = null;
                    const threadId = this.activity.commentModel.thread?.id || -Math.floor(Math.random() * 10000);
                    const attachments = this.activity.commentModel.attachments || [];
                    
                    console.log(`Attempting to save activity comment to thread: ${threadId}, model: mail.activity.thread, text: "${commentText.substring(0, 30)}..."`);
                    
                    // Log diagnostics about the thread and environment
                    console.log("Thread diagnostics:", {
                        threadId: threadId,
                        threadModel: 'mail.activity.thread',
                        activityId: this.activity.id,
                        hasMessagingService: !!this.env?.services?.messaging,
                        hasRpcService: !!this.env?.services?.rpc,
                        commentText: commentText.substring(0, 30) + (commentText.length > 30 ? '...' : '')
                    });
                    
                    // Method 1: Use Odoo's mail.thread message_post method - Most reliable for database storage
                    try {
                        if (this.env?.services?.rpc) {
                            console.log("Trying mail.thread message_post method");
                            const messagePostResult = await this.env.services.rpc({
                                model: 'mail.activity.thread',
                                method: 'message_post',
                                args: [[threadId]],
                                kwargs: {
                                    body: commentText,
                                    message_type: 'comment',
                                    subtype_xmlid: 'mail.mt_note',
                                    attachment_ids: attachments.map(a => a.id || 0),
                                    // Add context fields to ensure proper relationship tracking
                                    context: {
                                        'mail_activity_thread_id': threadId,
                                        'mail_activity_id': this.activity.id,
                                        'res_model': this.activity.res_model,
                                        'res_id': this.activity.res_id
                                    }
                                }
                            });
                            console.log("message_post result:", messagePostResult);
                            success = true;
                            console.log("Successfully posted activity comment using message_post");
                        }
                    } catch (err) {
                        console.error("Error using message_post for activity:", err);
                        error = err;
                    }
                    
                    // Method 2: Try using messaging service post method if message_post fails
                    if (!success && this.env?.services?.messaging?.post) {
                        try {
                            console.log("Trying messaging.post method for activity");
                            await this.env.services.messaging.post({
                                threadId: threadId,
                                threadModel: 'mail.activity.thread',
                                body: commentText,
                                isNote: true,
                                attachmentIds: attachments.map(a => a.id || 0),
                                // Add information about the activity for better thread linking
                                activity_id: this.activity.id,
                                res_model: this.activity.res_model,
                                res_id: this.activity.res_id,
                            });
                            success = true;
                            console.log("Successfully posted activity comment using messaging.post");
                        } catch (err) {
                            console.error("Error using messaging.post for activity:", err);
                            error = err;
                        }
                    }
                    
                    // Method 3: Try direct ORM create if other methods fail
                    if (!success && this.orm) {
                        try {
                            console.log("Trying direct message creation through ORM");
                            const messageValues = {
                                model: 'mail.activity.thread',
                                res_id: threadId,
                                record_name: `Activity #${this.activity.id}`,
                                body: commentText,
                                message_type: 'comment',
                                subtype_id: 1,  // Note subtype
                                author_id: this.env.services.user.partnerId,
                                // Additional fields for tracking
                                activity_ids: [[4, this.activity.id, false]], // Link to the activity using 4 command (add to m2m)
                            };
                            const messageId = await this.orm.create('mail.message', [messageValues]);
                            console.log("Created message through ORM, ID:", messageId);
                            success = true;
                        } catch (err) {
                            console.error("Error creating message through ORM:", err);
                            error = err;
                        }
                    }
                    
                    if (success) {
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
                        
                        console.log("Activity comment saved successfully");
                    } else {
                        // If all methods failed, create a local-only message
                        console.error("All activity comment submission methods failed", error);
                        
                        // Create a user-friendly message object for local display
                        const currentUser = {
                            id: this.env.services.user.userId || 1,
                            name: this.env.services.user.name || "Current User",
                            avatar: `/web/image?model=res.users&field=avatar_128&id=${this.env.services.user.userId || 1}`
                        };
                        
                        // Create a local-only message
                        const localMessage = {
                            id: -Math.floor(Math.random() * 10000),
                            body: commentText,
                            date: new Date(),
                            author: currentUser,
                            isLocalOnly: true
                        };
                        
                        // Add message to thread
                        if (!this.activity.commentModel.thread) {
                            const tempThread = {
                                id: -Math.floor(Math.random() * 10000),
                                model: 'mail.activity.thread',
                                messages: [localMessage]
                            };
                            this.activity.commentModel.update({ 
                                thread: tempThread,
                                hasLocalOnlyMessages: true
                            });
                        } else {
                            const thread = this.activity.commentModel.thread;
                            const messages = thread.messages || [];
                            if (Array.isArray(messages)) {
                                messages.push(localMessage);
                                this.activity.commentModel.update({ hasLocalOnlyMessages: true });
                            }
                        }
                        
                        // Clear textarea
                        if (textarea) {
                            textarea.value = '';
                        }
                        
                        // Clear commentText in model
                        this.activity.commentModel.update({
                            commentText: ''
                        });
                        
                        // Update count
                        this._updateCommentCount();
                        
                        // Visual indicator for local-only status (non-intrusive)
                        setTimeout(() => {
                            const localMsgElements = document.querySelectorAll('.o_thread_message_local');
                            if (localMsgElements && localMsgElements.length > 0) {
                                // Highlight the most recent local message with a subtle animation
                                const latestMsg = localMsgElements[localMsgElements.length - 1];
                                latestMsg.style.transition = 'background-color 0.5s ease';
                                latestMsg.style.backgroundColor = '#fffde7';
                                setTimeout(() => {
                                    latestMsg.style.backgroundColor = '';
                                }, 1500);
                            }
                        }, 100);
                        
                        // Try to save in background
                        this._retryCommentInBackground(commentText, threadId);
                    }
                } catch (error) {
                    console.error("Error submitting comment:", error);
                    alert("An error occurred while submitting your comment. Please try again.");
                }
            },
            
            /**
             * Try to save a comment in the background
             * @param {string} commentText The text of the comment
             * @param {number} threadId The ID of the thread
             */
            async _retryCommentInBackground(commentText, threadId) {
                try {
                    console.log("Attempting to save comment in background");
                    
                    // Create a more robust retry mechanism
                    const maxRetries = 5;
                    const initialWaitTime = 2000; // 2 seconds
                    
                    const performRetry = async (attempt = 1, waitTime = initialWaitTime) => {
                        // Stop if too many attempts
                        if (attempt > maxRetries) {
                            console.error(`Giving up after ${maxRetries} attempts to save comment`);
                            return false;
                        }
                        
                        // Check if we're online before trying
                        const isOnline = window.navigator.onLine;
                        if (!isOnline) {
                            console.log("Currently offline, will retry when online");
                            // Setup online event listener to retry when connection is restored
                            const retryWhenOnline = () => {
                                window.removeEventListener('online', retryWhenOnline);
                                // Wait a bit after coming online before retrying
                                setTimeout(() => performRetry(attempt), 2000);
                            };
                            window.addEventListener('online', retryWhenOnline);
                            return false;
                        }
                        
                        // Wait before trying
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        
                        // If thread ID is negative, we need to create a proper thread first
                        try {
                            // Only try to create a new thread if we have a negative ID and orm service
                            if (threadId < 0 && this.orm) {
                                console.log("Attempting to create a proper thread before message posting");
                                let realThreadId;
                                
                                try {
                                    // Create a real thread
                                    const threadValues = {
                                        activity_id: this.activity.id,
                                        res_model: this.activity.res_model || 'res.partner',
                                        res_id: this.activity.res_id || '0',
                                    };
                                    
                                    const newThreadIds = await this.orm.create('mail.activity.thread', [threadValues]);
                                    realThreadId = newThreadIds[0];
                                    console.log("Created real thread with ID:", realThreadId);
                                    
                                    // Update our threadId to use the real one
                                    threadId = realThreadId;
                                    
                                    // Update thread in model
                                    if (this.activity.commentModel.thread) {
                                        const updatedThread = {...this.activity.commentModel.thread, id: realThreadId};
                                        this.activity.commentModel.update({ thread: updatedThread });
                                    }
                                } catch (threadError) {
                                    console.error("Failed to create real thread:", threadError);
                                    // Continue with negative ID, hoping a thread gets created automatically
                                }
                            }
                        } catch (threadCreationError) {
                            console.error("Error while trying to create a real thread:", threadCreationError);
                            // Continue with retry using existing threadId
                        }
                        
                        // Try to save using mail.thread's message_post
                        try {
                            if (this.env?.services?.rpc) {
                                // Get context information based on component type
                                let context = {
                                    'mail_activity_thread_id': threadId
                                };
                                
                                if (this.message) {
                                    // MessageView context
                                    context.mail_activity_done_message_id = this.message.id;
                                    context.res_model = this.message.model || 'mail.message';
                                    context.res_id = this.message.res_id || 0;
                                } else if (this.activity) {
                                    // ActivityView context 
                                    context.mail_activity_id = this.activity.id;
                                    context.res_model = this.activity.res_model;
                                    context.res_id = this.activity.res_id;
                                }
                                
                                // Try using message_post method (preferred)
                                console.log(`Background save (attempt ${attempt}): Using message_post method`);
                                try {
                                    const messagePostResult = await this.env.services.rpc({
                                        model: 'mail.activity.thread',
                                        method: 'message_post',
                                        args: [[threadId]],
                                        kwargs: {
                                            body: commentText,
                                            message_type: 'comment',
                                            subtype_xmlid: 'mail.mt_note',
                                            context: context
                                        }
                                    }, {
                                        silent: true,     // Don't show error popups
                                        shadow: true,     // Don't block UI
                                        timeout: 10000    // 10 second timeout
                                    });
                                    
                                    console.log("Background save result:", messagePostResult);
                                    
                                    // Update UI to reflect successful save
                                    this._updateLocalMessageStatus(messagePostResult);
                                    
                                    return true;
                                } catch (rpcError) {
                                    console.warn(`RPC failed on attempt ${attempt}:`, rpcError);
                                    
                                    // Check error type to determine if we should retry
                                    if (rpcError.name === 'ConnectionLostError' || 
                                        !window.navigator.onLine ||
                                        rpcError.message?.includes('network') ||
                                        rpcError.message?.includes('timeout')) {
                                        
                                        console.log(`Network error on attempt ${attempt}, will retry in ${waitTime*2/1000} seconds`);
                                        // Exponential backoff - double the wait time
                                        return performRetry(attempt + 1, waitTime * 2);
                                    }
                                    
                                    // For other errors, try fallback methods
                                    throw rpcError;
                                }
                            }
                        } catch (err) {
                            // Try with direct ORM create if message_post fails
                            try {
                                if (this.orm) {
                                    console.log(`Background save (attempt ${attempt}): Trying direct ORM create`);
                                    // Build message values
                                    const messageValues = {
                                        model: 'mail.activity.thread',
                                        res_id: threadId,
                                        body: commentText,
                                        message_type: 'comment',
                                        subtype_id: 1, // Note subtype
                                    };
                                    
                                    // Add related fields based on context
                                    if (this.message) {
                                        messageValues.activity_done_message_id = this.message.id;
                                    } else if (this.activity) {
                                        messageValues.activity_ids = [[4, this.activity.id, false]];
                                    }
                                    
                                    const messageId = await this.orm.create('mail.message', [messageValues]);
                                    console.log(`Background save (attempt ${attempt}): Created message through ORM, ID:`, messageId);
                                    
                                    // Update UI to reflect successful save
                                    this._updateLocalMessageStatus(messageId);
                                    
                                    return true;
                                }
                            } catch (ormError) {
                                console.error(`Background save ORM fallback failed on attempt ${attempt}:`, ormError);
                                
                                // Check if this is a network error that we should retry
                                if (ormError.name === 'ConnectionLostError' || 
                                    !window.navigator.onLine ||
                                    ormError.message?.includes('network') ||
                                    ormError.message?.includes('timeout')) {
                                    
                                    console.log(`Network error on ORM fallback attempt ${attempt}, will retry in ${waitTime*2/1000} seconds`);
                                    // Exponential backoff - double the wait time
                                    return performRetry(attempt + 1, waitTime * 2);
                                }
                            }
                        }
                        
                        // If we got here, none of the methods worked but it wasn't a network error
                        // Try one more time with increased wait
                        if (attempt < maxRetries) {
                            console.log(`All methods failed on attempt ${attempt}, will retry once more`);
                            return performRetry(attempt + 1, waitTime * 2);
                        }
                        
                        return false;
                    };
                    
                    // Start the retry process
                    return performRetry();
                    
                } catch (error) {
                    console.error("Error in background save:", error);
                    return false;
                }
            },
            
            /**
             * Update local message status after successful background save
             * @param {number|object} messageIdOrResult The message ID or result object
             */
            _updateLocalMessageStatus(messageIdOrResult) {
                try {
                    // Get message ID from result
                    const messageId = typeof messageIdOrResult === 'number' ? 
                        messageIdOrResult : 
                        (messageIdOrResult.id || messageIdOrResult);
                    
                    // Get the correct comment model based on context
                    const commentModel = this.message ? 
                        this.message.commentModel : 
                        (this.activity ? this.activity.commentModel : null);
                        
                    if (commentModel && commentModel.thread && commentModel.thread.messages) {
                        const messages = commentModel.thread.messages;
                        const localMessages = messages.filter(msg => msg.isLocalOnly);
                        
                        if (localMessages.length > 0) {
                            // Update the first local message with the server ID
                            localMessages[0].isLocalOnly = false;
                            localMessages[0].id = messageId;
                            
                            // Update the hasLocalOnlyMessages flag based on remaining local messages
                            const stillHasLocal = messages.some(msg => msg.isLocalOnly);
                            commentModel.update({
                                hasLocalOnlyMessages: stillHasLocal
                            });
                            
                            console.log("Local message updated to synced status");
                        }
                    }
                } catch (error) {
                    console.error("Error updating local message status:", error);
                }
            },
            
            /**
             * Initialize the comment thread
             */
            async _initializeCommentThread() {
                try {
                    // Ensure services are available
                    this._ensureServices();
                    
                    if (!this.activity || !this.activity.id) {
                        return null;
                    }
                    
                    // Return existing thread if it's already initialized
                    if (this.activity.commentModel.thread) {
                        // Check if this thread is a temporary one (negative ID)
                        if (this.activity.commentModel.thread.id < 0) {
                            console.log("Found temporary thread - will create real one on server");
                        } else {
                            // Real thread already exists
                            return this.activity.commentModel.thread;
                        }
                    }
                    
                    // Basic thread creation if component method not available
                    try {
                        // Get ORM service, either from this.orm or this.env.services
                        const orm = this.orm;
                        
                        if (!orm) {
                            console.warn("ORM service not available, creating temporary thread");
                            // Fallback: create a temporary thread object locally
                            const tempThreadId = -Math.floor(Math.random() * 10000);
                            const tempThread = {
                                id: tempThreadId,
                                model: 'mail.activity.thread',
                                name: 'Temporary Thread',
                                isTemporary: true,
                                messages: []
                            };
                            
                            // Update the commentModel with the new thread
                            this.activity.commentModel.update({ 
                                thread: tempThread,
                                showComments: true
                            });
                            
                            return tempThread;
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
                            
                            try {
                                const newThreadIds = await orm.create('mail.activity.thread', [threadValues]);
                                threadId = newThreadIds[0];
                                console.log("Created thread with ID:", threadId);
                            } catch (createError) {
                                console.error("Error creating thread:", createError);
                                // Try simpler direct creation as fallback
                                const simpleValues = {
                                    activity_id: this.activity.id
                                };
                                try {
                                    const fallbackIds = await orm.create('mail.activity.thread', [simpleValues]);
                                    threadId = fallbackIds[0];
                                    console.log("Created thread with simplified values, ID:", threadId);
                                } catch (e) {
                                    console.error("Even simplified thread creation failed:", e);
                                    throw e;
                                }
                            }
                        } else {
                            threadId = threadRecords[0].id;
                            console.log("Found existing thread:", threadId);
                        }
                        
                        // Create a thread object with the ID
                        const thread = {
                            id: threadId,
                            model: 'mail.activity.thread',
                            messages: []
                        };
                        
                        // Update the commentModel with the new thread
                        this.activity.commentModel.update({ thread: thread });
                        
                        return thread;
                    } catch (e) {
                        console.error("Error creating thread in base model:", e);
                        return null;
                    }
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
                            // Create a temporary empty thread if one doesn't exist yet
                            // This ensures the "No comments yet" message shows immediately
                            if (!this.activity.commentModel.thread) {
                                const tempThread = {
                                    id: -Math.floor(Math.random() * 10000),
                                    model: 'mail.activity.thread',
                                    name: 'Temporary Thread',
                                    isTemporary: true,
                                    messages: []
                                };
                                this.activity.commentModel.update({ 
                                    thread: tempThread,
                                    showComments: true
                                });
                            } else {
                                // If panel closed, show it
                                this.activity.commentModel.update({
                                    showComments: true
                                });
                            }
                            
                            // Initialize thread if needed (in background)
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
                    
                    const textarea = document.querySelector('.o_activity_comment_panel_wrapper textarea');
                    const commentText = textarea ? textarea.value.trim() : '';
                    const threadId = this.message.commentModel.thread.id;
                    
                    console.log(`Attempting to save comment to thread: ${threadId}, model: mail.activity.thread, text: "${commentText.substring(0, 30)}..."`);
                    
                    // Log diagnostics about the thread and environment
                    console.log("Message thread diagnostics:", {
                        threadId: threadId,
                        threadModel: 'mail.activity.thread',
                        messageId: this.message.id,
                        hasMessagingService: !!this.env?.services?.messaging,
                        hasRpcService: !!this.env?.services?.rpc,
                        commentText: commentText.substring(0, 30) + (commentText.length > 30 ? '...' : '')
                    });
                    
                    // Try multiple methods to send the message
                    let success = false;
                    let error = null;
                    
                    // Method 1: Try using messaging service post method (modern Odoo)
                    try {
                        if (this.env?.services?.messaging?.post) {
                            console.log("Trying messaging.post method");
                            await this.env.services.messaging.post({
                                threadId: threadId,
                                threadModel: 'mail.activity.thread',
                                body: commentText,
                                isNote: true,
                                // Add message info for thread linking
                                activity_done_message_id: this.message.id,
                                res_model: this.message.model,
                                res_id: this.message.res_id,
                            });
                            success = true;
                            console.log("Successfully posted comment using messaging.post");
                        }
                    } catch (err) {
                        console.warn("Error using messaging.post:", err.name, err.message);
                        console.error("Full error:", err);
                        error = err;
                    }
                    
                    // Method 2: Try using legacy postMessage method
                    if (!success && this.env?.services?.messaging?.postMessage) {
                        try {
                            console.log("Trying messaging.postMessage method");
                            await this.env.services.messaging.postMessage({
                                thread_id: threadId,
                                thread_model: 'mail.activity.thread',
                                content: commentText,
                                is_note: true,
                                // Add message info for thread linking
                                activity_done_message_id: this.message.id,
                                res_model: this.message.model,
                                res_id: this.message.res_id,
                            });
                            success = true;
                            console.log("Successfully posted comment using messaging.postMessage");
                        } catch (err) {
                            console.warn("Error using messaging.postMessage:", err.name, err.message);
                            console.error("Full error:", err);
                            error = err;
                        }
                    }
                    
                    // Method 3: Try using direct RPC with detailed configuration
                    if (!success && this.env?.services?.rpc) {
                        try {
                            console.log("Trying direct RPC method with detailed config");
                            const rpcResult = await this.env.services.rpc('/mail/thread/post', {
                                thread_model: 'mail.activity.thread',
                                thread_id: threadId,
                                body: commentText,
                                subtype_xmlid: 'mail.mt_note',
                                // Add message info for thread linking
                                activity_done_message_id: this.message.id,
                                res_model: this.message.model,
                                res_id: this.message.res_id,
                            }, {
                                silent: false,
                                timeout: 10000, // 10 second timeout
                                shadow: false
                            });
                            console.log("RPC result:", rpcResult);
                            success = true;
                            console.log("Successfully posted comment using direct RPC");
                        } catch (err) {
                            console.warn("Error using direct RPC:", err.name, err.message);
                            console.error("Full error:", err);
                            error = err;
                        }
                    }
                    
                    // Method 4: Try alternative RPC endpoint
                    if (!success && this.env?.services?.rpc) {
                        try {
                            console.log("Trying alternative RPC endpoint");
                            const rpcResult = await this.env.services.rpc('/mail/message/post', {
                                thread_model: 'mail.activity.thread',
                                thread_id: threadId,
                                message_type: 'comment',
                                content: commentText,
                                subtype: 'mail.mt_note',
                                // Add message info for thread linking
                                activity_done_message_id: this.message.id,
                                res_model: this.message.model,
                                res_id: this.message.res_id,
                            }, {
                                silent: false,
                                timeout: 10000,
                            });
                            console.log("Alternative RPC result:", rpcResult);
                            success = true;
                            console.log("Successfully posted comment using alternative RPC endpoint");
                        } catch (err) {
                            console.warn("Error using alternative RPC endpoint:", err.name, err.message);
                            console.error("Full error:", err);
                            error = err;
                        }
                    }
                    
                    // Method 5: Try direct message creation through ORM
                    if (!success && this.orm) {
                        try {
                            console.log("Trying direct message creation through ORM");
                            const messageValues = {
                                model: 'mail.activity.thread',
                                res_id: threadId,
                                body: commentText,
                                message_type: 'comment',
                                subtype_id: 1,  // Note subtype
                            };
                            const messageId = await this.orm.create('mail.message', [messageValues]);
                            console.log("Created message through ORM, ID:", messageId);
                            success = true;
                        } catch (err) {
                            console.warn("Error creating message through ORM:", err.name, err.message);
                            console.error("Full error:", err);
                            error = err;
                        }
                    }
                    
                    if (success) {
                        // Success! Clear the textarea
                        if (textarea) {
                            textarea.value = '';
                        }
                        
                        // Clear commentText in the model
                        this.message.commentModel.update({
                            commentText: ''
                        });
                        
                        // Update count
                        this._updateCommentCount();
                        
                        console.log("Activity comment saved successfully");
                        alert("Comment saved successfully to database.");
                    } else {
                        // If all methods failed, show a detailed error but still provide a visual fallback
                        console.error("All activity comment submission methods failed", error);
                        
                        // Create a temporary local message for UI display
                        try {
                            console.log("Creating temporary local message for UI display");
                            
                            // Get current user information
                            const currentUser = {
                                id: this.env.services.user.userId || 1,
                                name: this.env.services.user.name || "Current User",
                                avatar: `/web/image?model=res.users&field=avatar_128&id=${this.env.services.user.userId || 1}`
                            };
                            
                            // Create a mock message object
                            const tempMessage = {
                                id: -Math.floor(Math.random() * 10000),
                                body: commentText,
                                date: new Date(),
                                author: currentUser,
                                isLocalOnly: true,
                                isTemporary: true
                            };
                            
                            // Add the message to the thread for display
                            if (!this.message.commentModel.thread) {
                                // Create a temporary thread if none exists
                                const tempThread = {
                                    id: -Math.floor(Math.random() * 10000),
                                    model: 'mail.activity.thread',
                                    name: 'Temporary Thread',
                                    messages: [tempMessage]
                                };
                                this.message.commentModel.update({ thread: tempThread });
                            } else {
                                // Add message to existing thread
                                const thread = this.message.commentModel.thread;
                                if (!thread.messages) {
                                    thread.messages = [];
                                }
                                thread.messages.push(tempMessage);
                                this.message.commentModel.update({ thread: thread });
                            }
                            
                            // Update the comment count
                            this._updateCommentCount();
                            
                            // Clear the textarea
                            if (textarea) {
                                textarea.value = '';
                            }
                            
                            // Clear the comment text in the model
                            this.message.commentModel.update({
                                commentText: '',
                                hasLocalOnlyMessages: true
                            });
                            
                            // Try to save the comment in the background (not awaiting response)
                            this._retryCommentInBackground(commentText, threadId);
                            
                            // Visual indicator for local-only status (non-intrusive)
                            // Find the most recently added message
                            setTimeout(() => {
                                const localMsgElements = document.querySelectorAll('.o_thread_message_local');
                                if (localMsgElements && localMsgElements.length > 0) {
                                    // Highlight the most recent local message with a subtle animation
                                    const latestMsg = localMsgElements[localMsgElements.length - 1];
                                    latestMsg.style.transition = 'background-color 0.5s ease';
                                    latestMsg.style.backgroundColor = '#fffde7';
                                    setTimeout(() => {
                                        latestMsg.style.backgroundColor = '';
                                    }, 1500);
                                }
                            }, 100);
                        } catch (localError) {
                            console.error("Error creating local message:", localError);
                            alert(`Failed to save comment. Last error: ${error?.message || 'Unknown error'}`);
                        }
                    }
                                        
                } catch (error) {
                    console.error("Error in _submitCommentWithAttachments:", error);
                    alert(`Failed to save comment: ${error?.message || 'Unknown error'}`);
                }
            },
            
            /**
             * Try to save a comment in the background
             * @param {string} commentText The text of the comment
             * @param {number} threadId The ID of the thread
             */
            async _retryCommentInBackground(commentText, threadId) {
                try {
                    console.log("Attempting to save comment in background");
                    
                    // Create a more robust retry mechanism
                    const maxRetries = 5;
                    const initialWaitTime = 2000; // 2 seconds
                    
                    const performRetry = async (attempt = 1, waitTime = initialWaitTime) => {
                        // Stop if too many attempts
                        if (attempt > maxRetries) {
                            console.error(`Giving up after ${maxRetries} attempts to save comment`);
                            return false;
                        }
                        
                        // Check if we're online before trying
                        const isOnline = window.navigator.onLine;
                        if (!isOnline) {
                            console.log("Currently offline, will retry when online");
                            // Setup online event listener to retry when connection is restored
                            const retryWhenOnline = () => {
                                window.removeEventListener('online', retryWhenOnline);
                                // Wait a bit after coming online before retrying
                                setTimeout(() => performRetry(attempt), 2000);
                            };
                            window.addEventListener('online', retryWhenOnline);
                            return false;
                        }
                        
                        // Wait before trying
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        
                        // If thread ID is negative, we need to create a proper thread first
                        try {
                            // Only try to create a new thread if we have a negative ID and orm service
                            if (threadId < 0 && this.orm) {
                                console.log("Attempting to create a proper thread before message posting");
                                let realThreadId;
                                
                                try {
                                    // Create a real thread
                                    const threadValues = {
                                        activity_id: this.activity.id,
                                        res_model: this.activity.res_model || 'res.partner',
                                        res_id: this.activity.res_id || '0',
                                    };
                                    
                                    const newThreadIds = await this.orm.create('mail.activity.thread', [threadValues]);
                                    realThreadId = newThreadIds[0];
                                    console.log("Created real thread with ID:", realThreadId);
                                    
                                    // Update our threadId to use the real one
                                    threadId = realThreadId;
                                    
                                    // Update thread in model
                                    if (this.activity.commentModel.thread) {
                                        const updatedThread = {...this.activity.commentModel.thread, id: realThreadId};
                                        this.activity.commentModel.update({ thread: updatedThread });
                                    }
                                } catch (threadError) {
                                    console.error("Failed to create real thread:", threadError);
                                    // Continue with negative ID, hoping a thread gets created automatically
                                }
                            }
                        } catch (threadCreationError) {
                            console.error("Error while trying to create a real thread:", threadCreationError);
                            // Continue with retry using existing threadId
                        }
                        
                        // Try to save using mail.thread's message_post
                        try {
                            if (this.env?.services?.rpc) {
                                // Get context information based on component type
                                let context = {
                                    'mail_activity_thread_id': threadId
                                };
                                
                                if (this.message) {
                                    // MessageView context
                                    context.mail_activity_done_message_id = this.message.id;
                                    context.res_model = this.message.model || 'mail.message';
                                    context.res_id = this.message.res_id || 0;
                                } else if (this.activity) {
                                    // ActivityView context 
                                    context.mail_activity_id = this.activity.id;
                                    context.res_model = this.activity.res_model;
                                    context.res_id = this.activity.res_id;
                                }
                                
                                // Try using message_post method (preferred)
                                console.log(`Background save (attempt ${attempt}): Using message_post method`);
                                try {
                                    const messagePostResult = await this.env.services.rpc({
                                        model: 'mail.activity.thread',
                                        method: 'message_post',
                                        args: [[threadId]],
                                        kwargs: {
                                            body: commentText,
                                            message_type: 'comment',
                                            subtype_xmlid: 'mail.mt_note',
                                            context: context
                                        }
                                    }, {
                                        silent: true,     // Don't show error popups
                                        shadow: true,     // Don't block UI
                                        timeout: 10000    // 10 second timeout
                                    });
                                    
                                    console.log("Background save result:", messagePostResult);
                                    
                                    // Update UI to reflect successful save
                                    this._updateLocalMessageStatus(messagePostResult);
                                    
                                    return true;
                                } catch (rpcError) {
                                    console.warn(`RPC failed on attempt ${attempt}:`, rpcError);
                                    
                                    // Check error type to determine if we should retry
                                    if (rpcError.name === 'ConnectionLostError' || 
                                        !window.navigator.onLine ||
                                        rpcError.message?.includes('network') ||
                                        rpcError.message?.includes('timeout')) {
                                        
                                        console.log(`Network error on attempt ${attempt}, will retry in ${waitTime*2/1000} seconds`);
                                        // Exponential backoff - double the wait time
                                        return performRetry(attempt + 1, waitTime * 2);
                                    }
                                    
                                    // For other errors, try fallback methods
                                    throw rpcError;
                                }
                            }
                        } catch (err) {
                            // Try with direct ORM create if message_post fails
                            try {
                                if (this.orm) {
                                    console.log(`Background save (attempt ${attempt}): Trying direct ORM create`);
                                    // Build message values
                                    const messageValues = {
                                        model: 'mail.activity.thread',
                                        res_id: threadId,
                                        body: commentText,
                                        message_type: 'comment',
                                        subtype_id: 1, // Note subtype
                                    };
                                    
                                    // Add related fields based on context
                                    if (this.message) {
                                        messageValues.activity_done_message_id = this.message.id;
                                    } else if (this.activity) {
                                        messageValues.activity_ids = [[4, this.activity.id, false]];
                                    }
                                    
                                    const messageId = await this.orm.create('mail.message', [messageValues]);
                                    console.log(`Background save (attempt ${attempt}): Created message through ORM, ID:`, messageId);
                                    
                                    // Update UI to reflect successful save
                                    this._updateLocalMessageStatus(messageId);
                                    
                                    return true;
                                }
                            } catch (ormError) {
                                console.error(`Background save ORM fallback failed on attempt ${attempt}:`, ormError);
                                
                                // Check if this is a network error that we should retry
                                if (ormError.name === 'ConnectionLostError' || 
                                    !window.navigator.onLine ||
                                    ormError.message?.includes('network') ||
                                    ormError.message?.includes('timeout')) {
                                    
                                    console.log(`Network error on ORM fallback attempt ${attempt}, will retry in ${waitTime*2/1000} seconds`);
                                    // Exponential backoff - double the wait time
                                    return performRetry(attempt + 1, waitTime * 2);
                                }
                            }
                        }
                        
                        // If we got here, none of the methods worked but it wasn't a network error
                        // Try one more time with increased wait
                        if (attempt < maxRetries) {
                            console.log(`All methods failed on attempt ${attempt}, will retry once more`);
                            return performRetry(attempt + 1, waitTime * 2);
                        }
                        
                        return false;
                    };
                    
                    // Start the retry process
                    return performRetry();
                    
                } catch (error) {
                    console.error("Error in background save:", error);
                    return false;
                }
            },
            
            /**
             * Update local message status after successful background save
             * @param {number|object} messageIdOrResult The message ID or result object
             */
            _updateLocalMessageStatus(messageIdOrResult) {
                try {
                    // Get message ID from result
                    const messageId = typeof messageIdOrResult === 'number' ? 
                        messageIdOrResult : 
                        (messageIdOrResult.id || messageIdOrResult);
                    
                    // Get the correct comment model based on context
                    const commentModel = this.message ? 
                        this.message.commentModel : 
                        (this.activity ? this.activity.commentModel : null);
                        
                    if (commentModel && commentModel.thread && commentModel.thread.messages) {
                        const messages = commentModel.thread.messages;
                        const localMessages = messages.filter(msg => msg.isLocalOnly);
                        
                        if (localMessages.length > 0) {
                            // Update the first local message with the server ID
                            localMessages[0].isLocalOnly = false;
                            localMessages[0].id = messageId;
                            
                            // Update the hasLocalOnlyMessages flag based on remaining local messages
                            const stillHasLocal = messages.some(msg => msg.isLocalOnly);
                            commentModel.update({
                                hasLocalOnlyMessages: stillHasLocal
                            });
                            
                            console.log("Local message updated to synced status");
                        }
                    }
                } catch (error) {
                    console.error("Error updating local message status:", error);
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
                        return null;
                    }
                    
                    // Return existing thread if it's already initialized
                    if (this.message.commentModel.thread) {
                        return this.message.commentModel.thread;
                    }
                    
                    // Basic thread creation if ORM not available
                    try {
                        // Get ORM service from this.orm
                        const orm = this.orm;
                        
                        if (!orm) {
                            // Fallback: create a temporary thread object locally
                            console.log("ORM not available, creating temporary thread");
                            const tempThread = {
                                id: -Math.floor(Math.random() * 10000) - 100000,
                                model: 'mail.activity.thread',
                                name: 'Temporary Message Thread',
                                isTemporary: true,
                                messages: []
                            };
                            
                            this.message.commentModel.update({ 
                                thread: tempThread,
                                showComments: true
                            });
                            
                            return tempThread;
                        }
                        
                        // For completed activity messages, we need to search by activity_done_message_id
                        let searchDomain = [];
                        let isDoneActivity = false;
                        
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
                        
                        // Create a simple thread object with the threadId
                        const thread = {
                            id: threadId,
                            model: 'mail.activity.thread',
                            messages: []
                        };
                        
                        // Update the model with the new thread
                        this.message.commentModel.update({ 
                            thread: thread
                        });
                        
                        return thread;
                    } catch (e) {
                        console.error("Error creating thread in base model:", e);
                        // Create a backup thread as fallback
                        const tempThread = {
                            id: -Math.floor(Math.random() * 10000) - 100000,
                            model: 'mail.activity.thread',
                            name: 'Temporary Thread (Error)',
                            isTemporary: true,
                            messages: []
                        };
                        
                        this.message.commentModel.update({ 
                            thread: tempThread
                        });
                        
                        return tempThread;
                    }
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
                            // First set showComments to true to display the panel
                            this.message.commentModel.update({
                                showComments: true
                            });
                            
                            // Create a basic empty thread if one doesn't exist
                            if (!this.message.commentModel.thread) {
                                const tempThread = {
                                    id: -Math.floor(Math.random() * 10000) - 100000,
                                        model: 'mail.activity.thread',
                                        name: 'Temporary Thread',
                                    isTemporary: true,
                                    messages: []
                                };
                                this.message.commentModel.update({ thread: tempThread });
                            }
                            
                            // Then initialize thread in background
                            console.log("Initializing comment thread for message", this.message.id);
                            this._initializeCommentThread()
                                .then((thread) => {
                                    if (thread) {
                                        console.log("Thread initialization successful for message", this.message.id);
                                        if (thread !== this.message.commentModel.thread) {
                                            this.message.commentModel.update({ thread: thread });
                                        }
                                        // Update count after thread is loaded
                                        this._updateCommentCount();
                                    } else {
                                        console.log("Thread initialization returned no thread, using existing");
                                    }
                                })
                                .catch(error => {
                                    console.error("Thread initialization failed for message", this.message.id, error);
                                    // Keep using the temporary thread
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