/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { MessagingMenu } from "@mail/core/public_web/messaging_menu";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";

patch(MessagingMenu.prototype, {
    setup() {
        this.actionService = useService("action");
        this.store = useService("mail.store");
        this.orm = useService("orm");
        
        // Only initialize mail-specific services if we're in a private context
        if (!this.store.inPublicPage) {
            try {
                this.threadService = useService("mail.thread");
                this.chatWindowService = useService("mail.chat_window");
            } catch (error) {
                console.warn("Mail services not available:", error);
                this.threadService = null;
                this.chatWindowService = null;
            }
        }
        
        super.setup(...arguments);      
    },

    get threads() {
        // If we're in public context or thread service is not available, return empty array
        if (this.store.inPublicPage || !this.threadService) {
            return [];
        }

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
        if (!thread) return;

        // Only mark as read if we're in private context and thread service is available
        if (!this.store.inPublicPage && this.threadService) {
            this.markAsRead(thread);
        }

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

            // Only try to close chat window if we're in a private context and the service is available
            if (!this.store.inPublicPage && this.chatWindowService && this.store.discuss?.chatWindows) {
                const chatWindow = this.store.discuss.chatWindows.find(
                    (window) => window.thread?.eq(thread)
                );
                if (chatWindow) {
                    this.chatWindowService.close(chatWindow);
                }
            }
            this.close();

        } catch (error) {
            console.error("Failed to open discussion:", error);
        }
    }
});