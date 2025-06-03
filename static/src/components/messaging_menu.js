/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { MessagingMenu } from "@mail/core/public_web/messaging_menu";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";
import { useState } from "@odoo/owl";

// Add a defensive utility to always get a single string res_id (or resId) (insert near the top of the file, e.g. after imports)
function getResId(val) {
    if (val === undefined || val === null) {
        return null;
    }
    // If it's already a number, return it
    if (typeof val === 'number') {
        return val;
    }
    // If it's an array/tuple, take the first element and convert to number
    if (Array.isArray(val)) {
        const firstVal = val[0];
        if (typeof firstVal === 'number') {
            return firstVal;
        }
        const parsed = parseInt(firstVal, 10);
        return isNaN(parsed) ? null : parsed;
    }
    // If it's a string, try to convert to number
    if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? null : parsed;
    }
    return null;
}

patch(MessagingMenu.prototype, {
    setup() {
        // Call original setup first
        super.setup();
        
        // Initialize services directly without useState wrapper
        this.storeService = useService("mail.store");
        this.action = useService("action");
        this.orm = useService("orm");
        
        // Add state to handle activity thread
        Object.assign(this.state, {
            activityThreadInfo: null,
        });
    },

    get threads() {
        // Use original implementation as base
        const baseThreads = super.threads;
        if (!baseThreads) {
            return [];
        }

        // Filter thread as needed
        return baseThreads.filter(thread => {
            // Add filter for activity thread
            if (thread.model === 'mail.activity.thread') {
                return thread.needactionMessages?.length > 0;
            }
            // Filter other threads
            return thread.needactionMessages?.length > 0;
        });
    },

    async openDiscussion(thread) {
        if (!thread) {
            return;
        }

        // Mark as read as in original implementation
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
                const parsedResId = getResId(threadRecord.res_id);
                if (parsedResId === null) {
                    throw new Error('Invalid res_id value: must be a valid integer');
                }
                resId = parsedResId;
                
                threadInfo = {
                    threadModel: 'mail.activity.thread',
                    threadId: thread.id,
                    activityId: threadRecord.activity_id?.[0],
                    activityDoneMessageId: threadRecord.activity_done_message_id?.[0]
                };

                // Save thread info to state
                this.state.activityThreadInfo = threadInfo;
                
                // Save to session storage for access by other components
                sessionStorage.setItem('open_activity_comments', JSON.stringify(threadInfo));
            }

            // Open form view as in original implementation
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

            // Use action service as in original implementation
            await this.action.doAction(action);

            // Close chat window if exists
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
            // Add error notification if needed
        }
    },

    // Override method markAsRead to handle activity thread
    markAsRead(thread) {
        if (thread.model === 'mail.activity.thread') {
            // Handle marking activity thread as read
            if (thread.needactionMessages?.length > 0) {
                thread.markAllMessagesAsRead();
            }
        } else {
            // Use original implementation for other threads
            super.markAsRead(thread);
        }
    }
});