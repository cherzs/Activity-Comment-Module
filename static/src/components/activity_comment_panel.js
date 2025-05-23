/** @odoo-module **/

import { Activity } from "@mail/core/web/activity";
import { patch } from "@web/core/utils/patch";
import { useState, useRef, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Thread } from "@mail/core/common/thread";
import { Composer } from "@mail/core/common/composer";
import { _t } from "@web/core/l10n/translation";
import { browser } from "@web/core/browser/browser";
import { usePopover } from "@web/core/popover/popover_hook";
import { FileUploader } from "@web/views/fields/file_handler";
import { ActivityMailTemplate } from "@mail/core/web/activity_mail_template";
import { ActivityMarkAsDone } from "@mail/core/web/activity_markasdone_popover";
import { AvatarCardPopover } from "@mail/discuss/web/avatar_card/avatar_card_popover";
import { computeDelay, getMsToTomorrow } from "@mail/utils/common/dates";
import { useAttachmentUploader } from "@mail/core/common/attachment_uploader_hook";
import { rpc } from "@web/core/network/rpc";
import { markup } from "@odoo/owl";


patch(Activity, {
    components: Object.assign({}, Activity.components, { 
        Thread, 
        Composer,
        ActivityMailTemplate,
        FileUploader,
        ActivityMarkAsDone,
        AvatarCardPopover
    }),
    props: [
        "activity",
        "onActivityChanged",
        "reloadParentView",
        "data?"
    ],
    template: "mail.Activity"
});

patch(Activity.prototype, {
    setup() {
        super.setup();
        this.storeService = useService("mail.store");
        this.orm = useService("orm");
        
        this.state = useState({ 
            showDetails: false,
            showComments: false,
            thread: null,
            threadRecord: null,
            commentCount: 0,
            comments: [],
            texts: {
                addComment: _t(" Add a Comment"),
                hideComments: _t(" Hide Comments"),
                seeComments: _t(" See Comments"),
                addCommentPlaceholder: _t("Add a Comment...")
            }
        });

        this.markDonePopover = usePopover(ActivityMarkAsDone, { position: "right" });
        this.avatarCard = usePopover(AvatarCardPopover);
        
        this.commentRef = useRef('commentPanel');

        this.attachmentUploader = useAttachmentUploader(this.thread);

        onWillStart(async () => {
            console.log("[ActivityCommentPanel] props.activity:", this.props.activity);
            if (this.props.activity && 
                this.props.activity.id && 
                !this.storeService.inPublicPage) {
                try {
                    if (!this.props.activity.res_model || !this.props.activity.res_id) {
                        throw new Error('Missing required field for thread creation: res_model or res_id');
                    }
                    const res_id = getResId(this.props.activity.res_id);
                    if (res_id === null) {
                        throw new Error('Invalid res_id value: must be a valid integer');
                    }

                    const threadRecords = await this.orm.searchRead(
                        'mail.activity.thread',
                        [['activity_id', '=', this.props.activity.id]],
                        ['id']
                    );
                    if (this.__owl__ && this.__owl__.isDestroyed) return;

                    let threadId;

                    if (threadRecords.length === 0) {
                        const newThreadIds = await this.orm.create('mail.activity.thread', [{
                            activity_id: this.props.activity.id,
                            res_model: this.props.activity.res_model,
                            res_id: res_id,
                        }]);
                        if (this.__owl__ && this.__owl__.isDestroyed) return;
                        threadId = newThreadIds[0];
                    } else {
                        threadId = threadRecords[0].id;
                    }

                    const thread = this.storeService.Thread.insert({
                        model: 'mail.activity.thread',
                        id: threadId
                    });
                    if (this.__owl__ && this.__owl__.isDestroyed) return;
                    this.state.thread = thread;

                    await this.storeService.Thread.getOrFetch({
                        model: 'mail.activity.thread',
                        id: threadId
                    });
                    if (this.__owl__ && this.__owl__.isDestroyed) return;

                    if (!thread.composer) {
                        thread.composer = this.storeService.Composer.insert({
                            thread: thread,
                            type: 'note',
                            mode: 'extended'
                        });
                    }

                    console.log('FETCH THREAD MESSAGES', { thread_id: threadId, thread_model: "mail.activity.thread" });
                    const messages = await rpc("/mail/thread/messages", {
                        thread_id: threadId,
                        thread_model: "mail.activity.thread",
                    });
                    if (this.__owl__ && this.__owl__.isDestroyed) return;
                    console.log('FETCHED MESSAGES RESULT', messages);

                    if (messages && messages.messages) {
                        let messageObjs = messages.messages;
                        if (typeof messageObjs[0] === 'number' || typeof messageObjs[0] === 'string') {
                            messageObjs = await this.orm.searchRead(
                                'mail.message',
                                [['id', 'in', messageObjs]],
                                ['id', 'body', 'author_id', 'email_from', 'create_date', 'message_type']
                            );
                            if (this.__owl__ && this.__owl__.isDestroyed) return;
                        }
                        for (const message of messageObjs) {
                            this.storeService.Message.insert({
                                ...message,
                                thread: this.state.thread,
                            });
                        }
                        this.state.threadRecord = threadId;
                        this._updateCommentCount();

                        if (this.state.comments.length === 0) {
                            this.state.comments = messageObjs.filter(
                                msg => msg.body && msg.body.trim() !== ''
                            ).map(msg => ({
                                ...msg,
                                body: markup(msg.body),
                                author: msg.author_id
                                    ? { id: msg.author_id[0], name: msg.author_id[1], avatar_128: msg.author_id[2] }
                                    : { name: msg.email_from || "Unknown" },
                                avatarColor: "#e1eaff",
                                avatarUrl: (msg.author_id && msg.author_id[0]) ? `/web/image/res.partner/${msg.author_id[0]}/image_1920` : null,
                            }));
                            this.state.comments.sort((a, b) => new Date(a.create_date) - new Date(b.create_date));
                        }

                    }

                } catch (error) {
                    console.error("Failed to initialize activity thread:", error);
                }
            }
        });

        onMounted(() => {
            this.updateDelayAtNight();
            this._checkSessionStorage();
        });

        onWillUnmount(() => {
            browser.clearTimeout(this.updateDelayMidnightTimeout);
        });
    },

    get thread() {
        if (this.state.thread) {
            return this.state.thread;
        }
        return this.storeService.Thread.insert({
            model: this.props.activity.res_model,
            id: getResId(this.props.activity.res_id),
        });
    },

    toggleComments() {
        this.state.showComments = !this.state.showComments;
        if (!this.state.showComments) {
            this._updateCommentCount();
        }
    },

    getToggleText() {
        if (this.state.showComments) {
            return this.state.texts.hideComments;
        } else {
            return `${this.state.texts.seeComments} (${this.state.commentCount})`;
        }
    },

    _updateCommentCount() {
        if (this.state.thread) {
            const messages = this.storeService.Message.records;
            const threadMessages = Object.values(messages).filter(
                msg =>
                    msg.thread &&
                    msg.thread.id === this.state.thread.id &&
                    msg.message_type === 'comment' &&
                    msg.body && msg.body.trim() !== ''
            );
            this.state.commentCount = threadMessages.length;
        }
    },

    _checkSessionStorage() {
        try {
            const storedInfo = sessionStorage.getItem('open_activity_comments');
            if (storedInfo) {
                const threadInfo = JSON.parse(storedInfo);

                if (threadInfo &&
                    threadInfo.threadModel === 'mail.activity.thread' &&
                    threadInfo.activityId &&
                    threadInfo.activityId === this.props.activity.id) {

                    if (!this.state.showComments) {
                        this.toggleComments();
                    }

                    sessionStorage.removeItem('open_activity_comments');
                }
            }
        } catch (error) {
            console.error("Error checking session storage:", error);
        }
    },
});


function getResId(val) {
    if (val === undefined || val === null) {
        return null;
    }
    if (typeof val === 'number') {
        return val;
    }
    if (Array.isArray(val)) {
        const firstVal = val[0];
        if (typeof firstVal === 'number') {
            return firstVal;
        }
        const parsed = parseInt(firstVal, 10);
        return isNaN(parsed) ? null : parsed;
    }
    if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? null : parsed;
    }
    return null;
}