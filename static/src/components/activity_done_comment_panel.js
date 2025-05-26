/** @odoo-module **/
import { Message } from "@mail/core/common/message";
import { patch } from "@web/core/utils/patch";
import { useState, useRef, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Thread } from "@mail/core/common/thread";
import { Composer } from "@mail/core/common/composer";
import { _t } from "@web/core/l10n/translation";
import { browser } from "@web/core/browser/browser";
import { rpc } from "@web/core/network/rpc";
import { markup } from "@odoo/owl";
import { Activity } from "@mail/core/web/activity";
import { usePopover } from "@web/core/popover/popover_hook";


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

patch(Message, {
    components: Object.assign({}, Message.components, { Thread, Composer })
});

patch(Message.prototype, {
    async willStart() {
        this.store = useService("mail.store");
        this.orm = useService("orm");

        return super.willStart && super.willStart();
    },
});

// Then patch our specific implementation
patch(Message.prototype, {
    setup() {
        super.setup();
        this.storeService = useService("mail.store");
        this.orm = useService("orm");
        this.state = useState({
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
        this.commentRef = useRef('commentPanel');
        onWillStart(async () => {
            if (!this.storeService || this.storeService.inPublicPage) {
                return;
            }
            if (this.props.message && this.props.message.id) {
                try {
                    if (!this.props.message.model || !this.props.message.res_id) {
                        throw new Error('Missing required field for thread creation: model or res_id');
                    }
                    const res_id = getResId(this.props.message.res_id);
                    if (res_id === null) {
                        throw new Error('Invalid res_id value: must be a valid integer');
                    }
                    const threadRecords = await this.orm.searchRead(
                        'mail.activity.thread',
                        [['activity_done_message_id', '=', this.props.message.id]],
                        ['id']
                    );
                    let threadId;
                    if (threadRecords.length === 0) {
                        const newThreadIds = await this.orm.create('mail.activity.thread', [{
                            activity_done_message_id: this.props.message.id,
                            res_model: this.props.message.model,
                            res_id: res_id,
                        }]);
                        threadId = newThreadIds[0];
                    } else {
                        threadId = threadRecords[0].id;
                    }
                    const thread = this.storeService.Thread.insert({
                        model: 'mail.activity.thread',
                        id: threadId
                    });
                    this.state.thread = thread;
                    await this.storeService.Thread.getOrFetch({
                        model: 'mail.activity.thread',
                        id: threadId
                    });
                    if (!thread.composer) {
                        thread.composer = this.storeService.Composer.insert({
                            thread: thread,
                            type: 'note',
                            mode: 'extended'
                        });
                    }
                    const messages = await rpc("/mail/thread/messages", {
                        thread_id: threadId,
                        thread_model: "mail.activity.thread",
                    });
                    if (messages && messages.messages) {
                        let messageObjs = messages.messages;
                        if (typeof messageObjs[0] === 'number' || typeof messageObjs[0] === 'string') {
                            messageObjs = await this.orm.searchRead(
                                'mail.message',
                                [['id', 'in', messageObjs]],
                                ['id', 'body', 'author_id', 'email_from', 'create_date', 'message_type']
                            );
                        }
                        for (const message of messageObjs) {
                            this.storeService.Message.insert({
                                ...message,
                                thread: this.state.thread,
                            });
                        }
                        this.state.threadRecord = threadId;
                        const newComments = messageObjs.filter(
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
                        this.state.comments.splice(0, this.state.comments.length, ...newComments);
                        this.state.comments.sort((a, b) => new Date(a.create_date) - new Date(b.create_date));
                        this._updateCommentCount();
                    }
                } catch (error) {
                    console.error("Failed to initialize activity thread:", error);
                }
            }
        });

        onMounted(() => {
            this._checkSessionStorage();
            this._setupMessageListener();
        });

        onWillUnmount(() => {
            if (this.threadMessagesReaction) {
                this.threadMessagesReaction();
            }
        });
    },

    _updateCommentCount() {
        if (this.state.thread) {
            const messages = this.store.Message.records;
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

    getToggleText() {
        if (this.state.showComments) {
            return this.state.texts.hideComments;
        } else {
            return `${this.state.texts.seeComments} (${this.state.commentCount})`;
        }
    },

    _setupMessageListener() {
        if (this.state.thread) {
            this.threadMessagesReaction = () => {
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
                    
                    // Update comments array with new messages
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
                    }));
                    
                    // Sort comments by date
                    newComments.sort((a, b) => new Date(a.create_date) - new Date(b.create_date));
                    
                    // Update state.comments while preserving reactivity
                    this.state.comments.splice(0, this.state.comments.length, ...newComments);
                    
                    // If comments panel is open, scroll to bottom
                    if (this.state.showComments && this.commentRef.el) {
                        this.commentRef.el.scrollTop = this.commentRef.el.scrollHeight;
                    }
                }
            };
            this.threadMessagesReaction();
        }
    },

    _checkSessionStorage() {
        try {
            const storedInfo = sessionStorage.getItem('open_activity_comments');
            if (storedInfo) {
                const threadInfo = JSON.parse(storedInfo);

                if (threadInfo &&
                    threadInfo.threadModel === 'mail.activity.thread' &&
                    threadInfo.activityDoneMessageId &&
                    threadInfo.activityDoneMessageId === this.props.message.id) {

                    if (!this.state.showComments) {
                        this.toggleComments();
                    }
                    this._scrollIntoView();
                    sessionStorage.removeItem('open_activity_comments');
                }
            }
        } catch (error) {
            console.error("Error checking session storage:", error);
        }
    },

    _scrollIntoView() {
        try {
            if (this.props.message && this.props.message.id) {
                setTimeout(() => {
                    const allMessages = document.querySelectorAll('.o-mail-Message');
                    for (const msg of allMessages) {
                        if (msg.textContent.includes(this.props.message.body) ||
                            msg.innerHTML.includes(this.props.message.body)) {
                            msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            return;
                        }
                    }

                    if (this.commentRef.el) {
                        this.commentRef.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }, 100);
            }
        } catch (error) {
            console.error("Error scrolling message into view:", error);
        }
    },

});
