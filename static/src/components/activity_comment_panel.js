/** @odoo-module **/

import { Activity } from "@mail/core/web/activity";
import { patch } from "@web/core/utils/patch";
import { useState, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Thread } from "@mail/core/common/thread";
import { Composer } from "@mail/core/common/composer";
import { _t } from "@web/core/l10n/translation";
import { browser } from "@web/core/browser/browser";
import { FileUploader } from "@web/views/fields/file_handler";
import { ActivityMailTemplate } from "@mail/core/web/activity_mail_template";
import { ActivityMarkAsDone } from "@mail/core/web/activity_markasdone_popover";
import { AvatarCardPopover } from "@mail/discuss/web/avatar_card/avatar_card_popover";
import { toRaw } from "@odoo/owl"; // Import toRaw


patch(Activity, {
    components: Object.assign({}, Activity.components, { 
        Thread, 
        Composer,
        ActivityMailTemplate,
        FileUploader,
        ActivityMarkAsDone,
        AvatarCardPopover,
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
        
        // Initialize all services first
        this.storeService = useService("mail.store");
        this.orm = useService("orm");
        this.busService = useService("bus_service");
        
        // Initialize state
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
            },
        });

        
        onWillStart(async () => {
            if (this.props.activity && this.props.activity.id ) {
                try {
                    if (!this.props.activity.res_model || !this.props.activity.res_id) {
                        throw new Error('Missing required field for thread creation: res_model or res_id');
                    }

                    const threadRecords = await this.orm.searchRead(
                        'mail.activity.thread',
                        [['activity_id', '=', this.props.activity.id]],
                        ['id']
                    );

                    let threadId;

                    if (threadRecords.length === 0) {
                        const newThreadIds = await this.orm.create('mail.activity.thread', [{
                            activity_id: this.props.activity.id,
                            res_model: this.props.activity.res_model,
                            res_id: this.props.activity.res_id,
                        }]);
                        threadId = newThreadIds[0];
                    } else {
                        threadId = threadRecords[0].id;
                    }

                    // Ensure thread is correctly inserted/fetched from store
                    this.state.thread = this.storeService.Thread.insert({
                        model: 'mail.activity.thread',
                        id: threadId,
                        // Add any other necessary properties for the thread model here
                    });
                    
                    // FIXED: Call fetchNewMessages directly on the thread instance.
                    // Use toRaw to access the underlying non-reactive object for method calls if needed.
                    await toRaw(this.state.thread).fetchNewMessages(); 
                    this.state.threadRecord = threadId;

                    // This might be redundant if fetchNewMessages already populates messages
                    // You can consider removing this line if fetchNewMessages covers its purpose.
                    // For now, keeping it as it doesn't cause harm and might ensure store consistency.
                    await this.storeService.Thread.getOrFetch({
                        model: 'mail.activity.thread',
                        id: threadId
                    });

                    if (this.state.thread && this.state.thread.messages) {
                        let messageObjs = this.state.thread.messages;
                        if (typeof messageObjs[0] === 'number' || typeof messageObjs[0] === 'string') {
                            // Fetch full message objects if only IDs are present
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

                    this._updateCommentsFromStore(); 

                } catch (error) {
                    console.error("[DEBUG] Failed to initialize activity thread (in try-catch):", error);
                }
            }
        });

        onMounted(() => {
            this.updateDelayAtNight(); 
            this._checkSessionStorage();
        });

        onWillUnmount(() => {
            browser.clearTimeout(this.updateDelayMidnightTimeout); 
            if (this.busService) {
                this.busService.removeEventListener("notification", this._onBusNotification); 
            }
            if (this.env.bus) {
                this.env.bus.removeEventListener("activity_comment_posted", this._onActivityCommentPosted.bind(this)); 
            }
            // Clean up attachment uploader if it exists
            if (this.attachmentUploader) {
                this.attachmentUploader = null;
            }
        });
    },

    // --- Added missing or undefined methods based on their usage in the original code ---
    _updateCommentsFromStore() {
        if (this.state.thread) {
            const messages = this.storeService.Message.records;
            const threadComments = Object.values(messages).filter(
                (msg) =>
                    msg.thread &&
                    msg.thread.id === this.state.thread.id &&
                    msg.message_type === 'comment'
            ).sort((a, b) => a.id - b.id); 
            this.state.comments = threadComments;
        }
    },

    updateDelayAtNight() {
        // Placeholder, define if needed.
    },

    _onBusNotification(notifications) {
        // Placeholder, define if needed.
    },

    _onActivityCommentPosted(payload) {
        if (payload.threadId === this.state.thread.id && payload.threadModel === this.state.thread.model) {
            this._updateCommentCount();
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
    }
});

patch(Composer.prototype, {
    async sendMessage(...args) {
        const result = await super.sendMessage(...args);
        if (this.props.composer && this.props.composer.thread) {
            this.env.bus.trigger("activity_comment_posted", {
                threadId: this.props.composer.thread.id,
                threadModel: this.props.composer.thread.model,
            });
        }
        return result;
    }
});
