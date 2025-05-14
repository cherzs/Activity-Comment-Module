/** @odoo-module **/

import { useService } from "@web/core/utils/hooks";
import { patch } from '@web/core/utils/patch';
import { MessagingMenu } from "@mail/components/messaging_menu/messaging_menu";

/**
 * This module extends the MessagingMenu component to add 
 * activity thread handling
 */
export function messagingMenuFactory(addons) {
    const MessagingMenuPatch = {
        setup() {
            this._super(...arguments);
            
            // Use serviceRegistry to check if services are available before using them
            try {
                this.actionService = useService("action");
                this.orm = useService("orm");
            } catch (e) {
                console.error("Error setting up messaging menu:", e);
            }
        },

        get threads() {
            try {
                const threads = this._super(...arguments);
                if (!threads) {
                    return [];
                }
                
                return threads.filter(thread => {
                    if (thread.needactionMessages && thread.needactionMessages.length > 0) {
                        return true;
                    }
            
                    return false;
                });
            } catch (e) {
                console.error("Error getting threads:", e);
                return [];
            }
        },

        async openDiscussion(thread) {
            try {
                let resModel;
                let resId;
                let threadInfo = null;
                try {
                    if (thread.model === 'mail.activity.thread' && this.orm) {
                        const threadRecord = await this.orm.searchRead(
                            'mail.activity.thread',
                            [['id', '=', thread.id]],
                            ['activity_id', 'activity_done_message_id', 'res_model', 'res_id']
                        );
                        resModel = threadRecord[0]?.res_model;
                        resId = parseInt(threadRecord[0]?.res_id);
                        if (!resId) throw new Error("Missing res_id in activity");
                        threadInfo = {
                            threadModel: 'mail.activity.thread',
                            threadId: thread.id,
                            activityId: threadRecord[0]?.activity_id[0],
                            activityDoneMessageId: threadRecord[0]?.activity_done_message_id[0]
                        };
                    } else if (thread.model === 'knowledge.article.thread' && this.orm) {
                        const articleRecord = await this.orm.searchRead(
                            'knowledge.article.thread',
                            [['id', '=', thread.id]],
                            ['article_id']
                        );
                        resModel = 'knowledge.article';
                        resId = articleRecord[0]?.article_id?.[0];
                        if (!resId) throw new Error("Missing res_id in knowledge");
                    } else {
                        resModel = thread.model;
                        resId = thread.id;
                    }
                    if (threadInfo) {
                        try {
                            sessionStorage.setItem('open_activity_comments', JSON.stringify(threadInfo));
                        } catch (e) {
                            console.error("Failed to store thread info in session storage:", e);
                        }
                    }
                    if (this.actionService) {
                        this.actionService.doAction({
                            type: "ir.actions.act_window",
                            res_id: resId,
                            res_model: resModel,
                            views: [[false, "form"]],
                            target: 'current',
                            display_name: thread.name
                        }, {
                            clearBreadcrumbs: false,
                            additionalContext: {
                                active_id: resId,
                                active_model: resModel
                            }
                        });
                    }
                    if (typeof this.close === 'function') {
                        this.close();
                    }
                } catch (error) {
                    console.error("Failed to open discussion:", error);
                }
            } catch (e) {
                console.error("Error in openDiscussion:", e);
            }
        }
    };
    
    patch(MessagingMenu.prototype, 'activity_messaging_menu', MessagingMenuPatch);
}

messagingMenuFactory();