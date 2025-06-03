/** @odoo-module **/

import { Activity } from "@mail/core/web/activity";
import { patch } from "@web/core/utils/patch";
import { useState, useRef, onWillStart, onMounted, onWillUnmount, effect } from "@odoo/owl";
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
        this.busService = useService("bus_service");
        
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
            // console.log("[ActivityCommentPanel] props.activity:", this.props.activity);
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
                    // console.log("[DEBUG] this.state.thread after insert:", this.state.thread);

                    await this.storeService.Thread.getOrFetch({
                        model: 'mail.activity.thread',
                        id: threadId
                    });
                    if (this.__owl__ && this.__owl__.isDestroyed) return;

                    // Initialize composer for the thread if it doesn't exist
                    if (!thread.composer) {
                        thread.composer = this.storeService.Composer.insert({
                            thread: thread,
                            type: 'note',
                            mode: 'extended',
                        });
                    }

                    // console.log('FETCH THREAD MESSAGES', { thread_id: threadId, thread_model: "mail.activity.thread" });
                    const messages = await rpc("/mail/thread/messages", {
                        thread_id: threadId,
                        thread_model: "mail.activity.thread",
                    });
                    if (this.__owl__ && this.__owl__.isDestroyed) return;
                    // console.log('FETCHED MESSAGES RESULT from RPC:', messages);

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
                        // console.log("[DEBUG] Messages inserted into mail.store. Total messages:", Object.keys(this.storeService.Message.records).length);
                        // console.log("[DEBUG] Messages in store for this thread:", Object.values(this.storeService.Message.records).filter(m => m.thread && m.thread.id === this.state.thread.id));

                        this.state.threadRecord = threadId;
                        this._updateCommentCount();

                        if (this.state.comments.length === 0) {
                            this.state.comments = messageObjs.filter(
                                msg => (msg.body && msg.body.trim() !== '') || (msg.attachment_ids && msg.attachment_ids.length > 0)
                            ).map(msg => ({
                                ...msg,
                                body: markup(msg.body),
                                author: msg.author_id
                                    ? { id: msg.author_id[0], name: msg.author_id[1], avatar_128: msg.author_id[2] }
                                    : { name: msg.email_from || "Unknown" },
                                avatarColor: "#e1eaff",
                                avatarUrl: (msg.author_id && msg.author_id[0]) ? `/web/image/res.partner/${msg.author_id[0]}/image_1920` : null,
                                formattedDate: formatDatetimeOdoo(msg.create_date),
                            }));
                            this.state.comments.sort((a, b) => new Date(a.create_date) - new Date(b.create_date));
                        }
                        // console.log("[DEBUG] this.state.comments after initial population:", this.state.comments);
                    }

                    this._updateCommentsFromStore();
                    await this._fetchAndHydrateComments();

                } catch (error) {
                    // console.error("[DEBUG] Failed to initialize activity thread (in try-catch):", error);
                }
            }
        });

        onMounted(() => {
            this.updateDelayAtNight();
            this._checkSessionStorage();
            this._setupBusListeners();
            this.env.bus.addEventListener("activity_comment_posted", this._onActivityCommentPosted.bind(this));
        });

        onWillUnmount(() => {
            browser.clearTimeout(this.updateDelayMidnightTimeout);
            if (this.busService) {
                this.busService.removeEventListener("notification", this._onBusNotification);
            }
            this.env.bus.removeEventListener("activity_comment_posted", this._onActivityCommentPosted.bind(this));
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
        } else if (this.commentRef.el) {
            this.commentRef.el.scrollTop = this.commentRef.el.scrollHeight;
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
                    (msg.body && msg.body.trim() !== '') || (msg.attachment_ids && msg.attachment_ids.length > 0)
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
            // console.error("Error checking session storage:", error);
        }
    },

    _setupBusListeners() {
        this.busService.addEventListener("notification", this._onBusNotification.bind(this));
    },

    _onBusNotification(notifications) {
        for (const { payload, type } of notifications) {
            if (type === "mail.message/new" && this.state.thread) {
                if (payload.res_id === this.state.thread.id && payload.model === this.state.thread.model) {
                    this._updateCommentsFromStore();
                }
            }
        }
    },

    _updateCommentsFromStore() {
        if (this.state.thread) {
            const messages = this.storeService.Message.records;
            const threadMessages = Object.values(messages).filter(
                msg =>
                    msg.thread &&
                    msg.thread.id === this.state.thread.id &&
                    msg.message_type === 'comment' &&
                    (msg.body && msg.body.trim() !== '') || (msg.attachment_ids && msg.attachment_ids.length > 0)
            );

            this.state.commentCount = threadMessages.length;

            // Always update the comments array (force reactivity)
            const newComments = threadMessages.map(msg => ({
                ...msg,
                body: markup(msg.body),
                author: msg.author_id
                    ? { id: msg.author_id[0], name: msg.author_id[1], avatar_128: msg.author_id[2] }
                    : { name: msg.email_from || "Unknown" },
                avatarColor: "#e1eaff",
                avatarUrl: (msg.author_id && msg.author_id[0])
                    ? `/web/image/res.partner/${msg.author_id[0]}/image_1920`
                    : null,
                create_date: msg.create_date,
                formattedDate: formatDatetimeOdoo(msg.create_date),
            }));

            newComments.sort((a, b) => new Date(a.create_date) - new Date(b.create_date));

            this.state.comments.splice(0, this.state.comments.length, ...newComments);
        }
    },

    _onActivityCommentPosted(ev) {
        const { threadId, threadModel } = ev.detail;
        if (this.state.thread && this.state.thread.id === threadId && this.state.thread.model === threadModel) {
            this._fetchAndHydrateComments();
        }
    },

    async _fetchAndHydrateComments() {
        if (!this.state.thread) return;
        try {
            const messages = await rpc("/mail/thread/messages", {
                thread_id: this.state.thread.id,
                thread_model: "mail.activity.thread",
            });
            if (this.__owl__ && this.__owl__.isDestroyed) return;
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
                const threadMessages = messageObjs.filter(
                    msg => ((msg.body && msg.body.trim() !== '') || (msg.attachment_ids && msg.attachment_ids.length > 0)) && msg.message_type === 'comment'
                );
                const newComments = threadMessages.map(msg => ({
                    ...msg,
                    body: markup(msg.body),
                    author: msg.author_id
                        ? { id: msg.author_id[0], name: msg.author_id[1], avatar_128: msg.author_id[2] }
                        : { name: msg.email_from || "Unknown" },
                    avatarColor: "#e1eaff",
                    avatarUrl: (msg.author_id && msg.author_id[0])
                        ? `/web/image/res.partner/${msg.author_id[0]}/image_1920`
                        : null,
                    create_date: msg.create_date,
                    formattedDate: formatDatetimeOdoo(msg.create_date),
                }));
                newComments.sort((a, b) => new Date(a.create_date) - new Date(b.create_date));
                this.state.comments.splice(0, this.state.comments.length, ...newComments);
                this.state.commentCount = newComments.length;
                if (this.state.showComments && this.commentRef.el) {
                    this.commentRef.el.scrollTop = this.commentRef.el.scrollHeight;
                }
            }

            const allAttachmentIds = [];
            for (const msg of messageObjs) {
                if (msg.attachment_ids && msg.attachment_ids.length) {
                    allAttachmentIds.push(...msg.attachment_ids);
                }
            }
            const attachmentDetails = await fetchAttachmentDetails(this.orm, allAttachmentIds);

        } catch (error) {
            // console.error("Failed to re-fetch comments:", error);
        }
    }
});

patch(Composer.prototype, {
    async sendMessage(...args) {
        const result = await super.sendMessage(...args);
        this.env.bus.trigger("activity_comment_posted", {
            threadId: this.props.composer.thread.id,
            threadModel: this.props.composer.thread.model,
        });
        return result;
    }
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

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function formatDatetimeOdoo(dt) {
    if (!dt) return '';
    let date;
    if (typeof dt === 'string') {
        // if format Odoo (YYYY-MM-DD HH:mm:ss), add 'Z' to be considered UTC
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dt)) {
            date = new Date(dt.replace(' ', 'T') + 'Z');
        } else {
            date = new Date(dt);
        }
    } else {
        date = dt;
    }
    if (!(date instanceof Date) || isNaN(date)) return '';

    // Get timezone from cookie
    const tz = getCookie('tz') || Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Convert UTC to local user time (with Intl)
    const now = new Date();
    // For relative time, still use UTC, because Date.now() is also UTC
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) {
        const mins = Math.floor(diffSec / 60);
        return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
    }
    if (diffSec < 86400) {
        const hours = Math.floor(diffSec / 3600);
        return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    }
    if (diffSec < 2592000) {
        const days = Math.floor(diffSec / 86400);
        return days === 1 ? '1 day ago' : `${days} days ago`;
    }
    // For absolute date, show according to user timezone
    return new Intl.DateTimeFormat('default', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: tz
    }).format(date);
}

async function fetchAttachmentDetails(orm, allAttachmentIds) {
    if (!allAttachmentIds.length) return [];
    return await orm.searchRead(
        'ir.attachment',
        [['id', 'in', allAttachmentIds]],
        ['id', 'name', 'mimetype']
    );
}