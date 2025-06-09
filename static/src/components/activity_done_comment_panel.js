/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { useState, onWillStart, onMounted } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Thread } from "@mail/core/common/thread";
import { Composer } from "@mail/core/common/composer";
import { _t } from "@web/core/l10n/translation";
import { markup } from "@odoo/owl";
import { toRaw } from "@odoo/owl";
import { Message } from "@mail/core/common/message";


patch(Message, {
    components: Object.assign({}, Message.components, { Thread, Composer }),
});

patch(Message.prototype, {
    setup() {
        super.setup();
        this.storeService = useService("mail.store");
        this.orm = useService("orm");
        this.busService = useService("bus_service");
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
            },
        });

        onWillStart(async () => {
            if (this.props.message && this.props.message.id) {
                try {
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
                            res_id: this.props.message.res_id,
                        }]);
                        threadId = newThreadIds[0];
                    } else {
                        threadId = threadRecords[0].id;
                    }
                    this.state.thread = this.storeService.Thread.insert({
                        model: 'mail.activity.thread',
                        id: threadId,
                    });
                    await toRaw(this.state.thread).fetchNewMessages();
                    this.state.threadRecord = threadId;
                    await this.storeService.Thread.getOrFetch({
                        model: 'mail.activity.thread',
                        id: threadId
                    });
                    if (this.state.thread && this.state.thread.messages) {
                        let messageObjs = this.state.thread.messages;
                        if (typeof messageObjs[0] === 'number' || typeof messageObjs[0] === 'string') {
                            messageObjs = await this.orm.searchRead(
                                'mail.message',
                                [['id', 'in', messageObjs]],
                                ['id', 'body', 'author_id', 'email_from', 'create_date', 'message_type', 'attachment_ids']
                            );
                        }
                        for (const message of messageObjs) {
                            this.storeService.Message.insert({
                                ...message,
                                thread: this.state.thread,
                            });
                        }
                        this.state.threadRecord = threadId;
                        this._updateCommentCount();
                    }

                } catch (error) {
                    console.error("[DEBUG] Failed to initialize activity thread (in try-catch):", error);
                }
            }
        });

        onMounted(() => {
            this._setupMessageListener();
            this._checkSessionStorage();
        });
    },

    _updateCommentCount() {
        if (this.state.thread) {
            const messages = this.storeService.Message.records;
            const threadMessages = Object.values(messages).filter(
                msg =>
                    msg.thread &&
                    msg.thread.id === this.state.thread.id &&
                    msg.message_type === 'comment' &&
                    ((msg.body && msg.body.trim() !== '') || (msg.attachment_ids && msg.attachment_ids.length > 0))
            );
            this.state.commentCount = threadMessages.length;
        }
    },

    toggleComments() {
        this.state.showComments = !this.state.showComments;
        if (!this.state.showComments) {
            this._updateCommentCount();
        } else if (this.commentRef && this.commentRef.el) {
            setTimeout(() => {
                if (this.commentRef && this.commentRef.el) {
                    this.commentRef.el.scrollTop = this.commentRef.el.scrollHeight;
                }
            }, 0);
        }
    },

    getToggleText() {
        if (this.state.showComments) {
            return this.state.texts.hideComments;
        } else if (this.state.commentCount > 0) {
            return `${this.state.texts.seeComments} (${this.state.commentCount})`;
        } else {
            return this.state.texts.addComment;
        }
    },

    _setupMessageListener() {
        if (this.state.thread) {
            this.threadMessagesReaction = () => {
                if (this.state.thread && this.state.thread.messages) {
                    const validMessages = this.state.thread.messages.filter(
                        msg => msg && msg.body && msg.body.trim() !== ''
                    );
                    this.state.commentCount = validMessages.length;
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
                    threadInfo.activityId &&
                    threadInfo.activityId === this.props.message.id) {
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