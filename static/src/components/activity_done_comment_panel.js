/** @odoo-module **/
import { Message } from "@mail/components/message/message";
import { patch } from "@web/core/utils/patch";
import { useState, useRef, onWillStart, onMounted } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";
import { registerPatch } from '@mail/model/model_core';

// First patch the MessageView model to include our comment functionality
registerPatch({
    name: 'MessageView',
    recordMethods: {
        /**
         * Toggle the visibility of comments for this message
         */
        toggleComments() {
            if (this.message.commentModel) {
                this.message.commentModel.update({
                    showComments: !this.message.commentModel.showComments
                });
                
                if (!this.message.commentModel.showComments) {
                    this._updateCommentCount();
                }
            }
        },
        
        /**
         * Update the comment count
         */
        _updateCommentCount() {
            if (this.message.commentModel && 
                this.message.commentModel.thread && 
                this.message.commentModel.thread.messages) {
                
                const validMessages = this.message.commentModel.thread.messages.filter(
                    msg => msg && msg.body && msg.body.trim() !== ''
                );
                this.message.commentModel.update({ 
                    commentCount: validMessages.length 
                });
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
        }
    },
});

/**
 * This module extends the Message component to add comment functionality
 * for completed activities
 */
export function activityDoneCommentPanelFactory(addons) {
    const MessagePatch = {
        setup() {
            this._super(...arguments);
            this.commentRef = useRef('commentPanel');
            
            try {
                // Safely try to get services that might not be available
                try {
                    this.rpc = useService("rpc");
                } catch (e) {
                    console.log("rpc service not available");
                    this.rpc = null;
                }
                
                try {
                    this.threadService = useService("mail.thread");
                } catch (e) {
                    console.log("mail.thread service not available");
                    this.threadService = null;
                }
                
                try {
                    this.store = useService("mail.store");
                } catch (e) {
                    console.log("mail.store service not available");
                    this.store = null;
                }
                
                this.orm = useService("orm");
                
                onWillStart(async () => {
                    // Only process for activity done messages with subtype_id[0] == 3
                    if (this.message &&
                        this.message.subtype_id &&
                        this.message.subtype_id[0] === 3 &&
                        this.message.id &&
                        this.threadService) {
                        await this._initializeCommentThread();
                    }
                });
                
                onMounted(() => {
                    if (this.message && this.message.commentModel) {
                        this._checkSessionStorage();
                    }
                });
            } catch (e) {
                console.error("Error setting up activity done comment panel:", e);
            }
        },
        
        get message() {
            return this.props.message;
        },
        
        async _initializeCommentThread() {
            try {
                if (!this.threadService || !this.orm) {
                    console.log("Required services not available");
                    return;
                }
                
                // Check if a thread record exists for this completed activity message
                const threadRecords = await this.orm.searchRead(
                    'mail.activity.thread',
                    [['activity_done_message_id', '=', this.message.id]],
                    ['id']
                );
                
                let threadId;
                
                if (threadRecords.length === 0) {
                    // Create a new thread record if none exists
                    const newThreadIds = await this.orm.create('mail.activity.thread', [{
                        activity_done_message_id: this.message.id,
                        res_model: this.message.model,
                        res_id: this.message.res_id,
                    }]);
                    threadId = newThreadIds[0];
                } else {
                    threadId = threadRecords[0].id;
                }
                
                // Get the thread for our custom model
                const thread = this.threadService.getThread('mail.activity.thread', threadId);
                await this.threadService.loadAround(thread);
                
                if (this.message.commentModel) {
                    this.message.commentModel.update({ 
                        thread: thread
                    });
                    
                    // Count valid messages
                    if (thread && thread.messages) {
                        const validMessages = thread.messages.filter(
                            msg => msg && msg.body && msg.body.trim() !== ''
                        );
                        this.message.commentModel.update({ 
                            commentCount: validMessages.length 
                        });
                    }
                }
            } catch (error) {
                console.error("Failed to initialize activity message thread:", error);
            }
        },
        
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
                        if (this.message.commentModel && !this.message.commentModel.showComments) {
                            this.message.commentModel.update({ showComments: true });
                        }
                        
                        // Scroll the message into view
                        const messageView = this.messageView;
                        if (messageView) {
                            messageView.scrollMessageIntoView();
                        }
                        
                        // Clear the storage so it doesn't keep opening
                        sessionStorage.removeItem('open_activity_comments');
                    }
                }
            } catch (error) {
                console.error("Error checking session storage:", error);
            }
        },
        
        get messageView() {
            try {
                // Get the messageView for this message
                // In Odoo 16, the message should have a corresponding messageView
                if (this.message && this.env && this.env.messaging) {
                    const allMessageViews = this.env.messaging.models['MessageView'].all();
                    return allMessageViews.find(view => view.message === this.message);
                }
            } catch (e) {
                console.error("Error getting messageView:", e);
            }
            return null;
        }
    };
    
    patch(Message.prototype, 'activity_done_comment_panel', MessagePatch);
}

activityDoneCommentPanelFactory();

