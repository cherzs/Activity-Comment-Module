/** @odoo-module **/

import { registerModel, registerPatch } from '@mail/model/model_core';
import { attr, one } from '@mail/model/model_field';
import { clear } from '@mail/model/model_field_command';

try {
    // Register ActivityCommentModel
    registerModel({
        name: 'ActivityCommentModel',
        recordMethods: {
            /**
             * Toggle the visibility of comments for this activity
             */
            toggleComments() {
                try {
                    this.update({
                        showComments: !this.showComments
                    });
                    
                    if (!this.showComments) {
                        this._updateCommentCount();
                    }
                } catch (e) {
                    console.error("Error in toggleComments:", e);
                }
            },
            
            /**
             * Get the text to display on the toggle button
             */
            getToggleText() {
                try {
                    if (this.showComments) {
                        return this.env._t(" Hide Comments");
                    } else if (this.commentCount > 0) {
                        return this.env._t(" See Comments") + ` (${this.commentCount})`;
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
                    this.update({
                        showComments: !this.showComments
                    });
                    
                    if (!this.showComments) {
                        this._updateCommentCount();
                    }
                } catch (e) {
                    console.error("Error in toggleComments:", e);
                }
            },
            
            /**
             * Get the text to display on the toggle button
             */
            getToggleText() {
                try {
                    if (this.showComments) {
                        return this.env._t(" Hide Comments");
                    } else if (this.commentCount > 0) {
                        return this.env._t(" See Comments") + ` (${this.commentCount})`;
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

    // Patch ActivityView model
    registerPatch({
        name: 'ActivityView',
        recordMethods: {
            /**
             * Toggle the visibility of comments for this activity
             */
            toggleComments() {
                try {
                    if (this.activity && this.activity.commentModel) {
                        this.activity.commentModel.update({
                            showComments: !this.activity.commentModel.showComments
                        });
                        
                        if (!this.activity.commentModel.showComments) {
                            this._updateCommentCount();
                        }
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
             * Toggle the visibility of comments for this message
             */
            toggleComments() {
                try {
                    if (this.message && this.message.commentModel) {
                        this.message.commentModel.update({
                            showComments: !this.message.commentModel.showComments
                        });
                        
                        if (!this.message.commentModel.showComments) {
                            this._updateCommentCount();
                        }
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
} catch (e) {
    console.error("Error registering activity comment models:", e);
} 