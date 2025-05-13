/** @odoo-module **/

import { useRef, onWillStart, onMounted } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { patch } from '@web/core/utils/patch';
import { Activity } from '@mail/components/activity/activity';

/**
 * This module extends the Activity component to add comment functionality
 */
export function activityCommentPanelFactory(addons) {
    const ActivityPatch = {
        setup() {
            this._super(...arguments);
            this.commentRef = useRef('commentPanel');
            
            try {
                // Safely try to get services that might not be available
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
                    if (this.activity && this.activity.id && this.threadService) {
                        await this._initializeCommentThread();
                    }
                });
                
                onMounted(() => {
                    if (this.activity && this.activity.commentModel) {
                        this._checkSessionStorage();
                    }
                });
            } catch (e) {
                console.error("Error setting up activity comment panel:", e);
            }
        },
        
        get activity() {
            return this.props.record;
        },
        
        async _initializeCommentThread() {
            try {
                if (!this.threadService || !this.orm) {
                    console.log("Required services not available");
                    return;
                }
                
                // Check if a thread record exists for this activity
                const threadRecords = await this.orm.searchRead(
                    'mail.activity.thread',
                    [['activity_id', '=', this.activity.id]],
                    ['id']
                );
                
                let threadId;
                
                if (threadRecords.length === 0) {
                    // Create a new thread record if none exists
                    const newThreadIds = await this.orm.create('mail.activity.thread', [{
                        activity_id: this.activity.id,
                        res_model: this.activity.res_model,
                        res_id: this.activity.res_id,
                    }]);
                    threadId = newThreadIds[0];
                } else {
                    threadId = threadRecords[0].id;
                }
                
                // Get the thread for our custom model
                const thread = this.threadService.getThread('mail.activity.thread', threadId);
                await this.threadService.loadAround(thread);
                
                if (this.activity.commentModel) {
                    this.activity.commentModel.update({ 
                        thread: thread,
                    });
                    
                    // Count valid messages
                    if (thread && thread.messages) {
                        const validMessages = thread.messages.filter(
                            msg => msg && msg.body && msg.body.trim() !== ''
                        );
                        this.activity.commentModel.update({ 
                            commentCount: validMessages.length 
                        });
                    }
                }
            } catch (error) {
                console.error("Failed to initialize activity thread:", error);
            }
        },
        
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
                        if (this.activity.commentModel && !this.activity.commentModel.showComments) {
                            this.activity.commentModel.update({ showComments: true });
                        }
                        
                        // Clear the storage so it doesn't keep opening
                        sessionStorage.removeItem('open_activity_comments');
                    }
                }
            } catch (error) {
                console.error("Error checking session storage:", error);
            }
        }
    };
    
    patch(Activity.prototype, 'activity_comment_panel', ActivityPatch);
}

activityCommentPanelFactory();
