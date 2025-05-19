/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { MessagingMenu } from "@mail/core/public_web/messaging_menu";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";
import { useState } from "@odoo/owl";

patch(MessagingMenu.prototype, {
    setup() {
        // Panggil setup asli terlebih dahulu
        super.setup();
        
        // Gunakan useState untuk store seperti di implementasi asli
        this.storeService = useState(useService("mail.store"));
        this.action = useService("action");
        this.orm = useService("orm");
        
        // Tambahkan state untuk menangani activity thread
        Object.assign(this.state, {
            activityThreadInfo: null,
        });

        // Inisialisasi service tambahan jika diperlukan
        if (!this.storeService.inPublicPage) {
            try {
                this.storeService = useService("mail.store");
            } catch (error) {
                console.warn("Mail services not available:", error);
            }
        }
    },

    get threads() {
        // Gunakan implementasi asli sebagai base
        const baseThreads = super.threads;
        if (!baseThreads) {
            return [];
        }

        // Filter thread sesuai kebutuhan
        return baseThreads.filter(thread => {
            // Tambahkan filter untuk activity thread
            if (thread.model === 'mail.activity.thread') {
                return thread.needactionMessages?.length > 0;
            }
            // Filter thread lainnya
            return thread.needactionMessages?.length > 0;
        });
    },

    async openDiscussion(thread) {
        if (!thread) {
            return;
        }

        // Mark as read seperti implementasi asli
        if (thread.needactionMessages?.length > 0) {
            this.markAsRead(thread);
        }

        try {
            let resModel, resId, threadInfo = null;

            // Handle activity thread
            if (thread.model === 'mail.activity.thread') {
                const [threadRecord] = await this.orm.searchRead(
                    'mail.activity.thread',
                    [['id', '=', thread.id]],
                    ['activity_id', 'activity_done_message_id', 'res_model', 'res_id']
                );

                if (!threadRecord) {
                    throw new Error("Activity thread not found");
                }

                resModel = threadRecord.res_model;
                resId = parseInt(threadRecord.res_id);
                
                threadInfo = {
                    threadModel: 'mail.activity.thread',
                    threadId: thread.id,
                    activityId: threadRecord.activity_id?.[0],
                    activityDoneMessageId: threadRecord.activity_done_message_id?.[0]
                };

                // Simpan info thread ke state
                this.state.activityThreadInfo = threadInfo;
                
                // Simpan ke session storage untuk akses di komponen lain
                sessionStorage.setItem('open_activity_comments', JSON.stringify(threadInfo));
            }

            // Buka form view seperti implementasi asli
            const action = {
                type: "ir.actions.act_window",
                res_model: resModel || thread.model,
                res_id: resId || thread.id,
                views: [[false, "form"]],
                target: 'current',
                context: {
                    active_id: resId || thread.id,
                    active_model: resModel || thread.model
                }
            };

            // Gunakan action service seperti di implementasi asli
            await this.action.doAction(action);

            // Tutup chat window jika ada
            if (this.storeService.discuss?.chatWindows) {
                const chatWindow = this.storeService.discuss.chatWindows.find(
                    window => window.thread?.eq(thread)
                );
                if (chatWindow) {
                    this.storeService.ChatWindow.get({ thread })?.close();
                }
            }

            // Tutup dropdown menu
            this.dropdown.close();

        } catch (error) {
            console.error("Failed to open discussion:", error);
            // Tambahkan notifikasi error jika diperlukan
        }
    },

    // Override method markAsRead untuk menangani activity thread
    markAsRead(thread) {
        if (thread.model === 'mail.activity.thread') {
            // Handle marking activity thread as read
            if (thread.needactionMessages?.length > 0) {
                thread.markAllMessagesAsRead();
            }
        } else {
            // Gunakan implementasi asli untuk thread lainnya
            super.markAsRead(thread);
        }
    }
});