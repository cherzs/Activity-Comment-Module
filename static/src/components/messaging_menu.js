/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { MessagingMenu } from "@mail/core/web/messaging_menu";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";

patch(MessagingMenu.prototype, {
    setup() {
        this.actionService = useService("action");
        this.chatWindowService = useService("mail.chat_window");
        this.store = useService("mail.store");
        this.threadService = useService("mail.thread");
        this.orm = useService("orm");
        super.setup(...arguments);      
    },

    get threads() {
        const threads = super.threads;
        if (!threads) {
            return [];
        }
        
        return threads.filter(thread => {
            if (thread.needactionMessages && thread.needactionMessages.length > 0) {
                return true;
            }
    
            return false;
        });
    },


    async openDiscussion(thread) {
        this.markAsRead(thread);

        let resModel;
        let resId;
        let threadInfo = null;

        try {
            if (thread.model === 'mail.activity.thread') {
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

            } else if (thread.model === 'knowledge.article.thread') {
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
                sessionStorage.setItem('open_activity_comments', JSON.stringify(threadInfo));
            }

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

            const chatWindow = this.store.discuss.chatWindows.find(
                (window) => window.thread?.eq(thread)
            );
            if (chatWindow) {
                this.chatWindowService.close(chatWindow);
            }
            this.close();

        } catch (error) {
            console.error("Failed to open discussion:", error);
        }
    }

});