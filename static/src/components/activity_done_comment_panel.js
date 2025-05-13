/** @odoo-module **/
import { Message } from "@mail/core/common/message";
import { patch } from "@web/core/utils/patch";
import { useState, useRef, onWillStart, onMounted } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Thread } from "@mail/core/common/thread";
import { Composer } from "@mail/core/common/composer";
import { _t } from "@web/core/l10n/translation";

// Patch the Message component to add Thread to its components
patch(Message, {
    components: Object.assign({}, Message.components, { Thread, Composer })
});

patch(Message.prototype, {
    setup() {
        super.setup();
        this.state.showComments = false;
        this.state.thread = null;
        this.state.threadRecord = null;
        this.state.commentCount = 0,
        this.state.texts = {
                addComment: _t(" Add a Comment"),
                hideComments: _t(" Hide Comments"),
                seeComments: _t(" See Comments"),
                addCommentPlaceholder: _t("Add a Comment...")
            };

        this.commentRef = useRef('commentPanel');
        this.rpc = useService("rpc");
        this.threadService = useService("mail.thread");
        this.store = useService("mail.store");
        this.orm = useService("orm");

        onWillStart(async () => {
            // Only process for activity done messages with subtype_id[0] == 3
            if (this.props.message &&
                this.props.message.subtype_id &&
                this.props.message.subtype_id[0] === 3 &&
                this.props.message.id) {

                try {
                    // Check if a thread record exists for this completed activity message
                    const threadRecords = await this.orm.searchRead(
                        'mail.activity.thread',
                        [['activity_done_message_id', '=', this.props.message.id]],
                        ['id']
                    );

                    let threadId;

                    if (threadRecords.length === 0) {
                        // Create a new thread record if none exists
                        // orm.create returns an array of IDs, take the first one
                        const newThreadIds = await this.orm.create('mail.activity.thread', [{
                            activity_done_message_id: this.props.message.id,
                            res_model: this.props.message.model,
                            res_id: this.props.message.res_id,
                        }]);
                        threadId = newThreadIds[0]; // Get the first ID from the returned array
                    } else {
                        threadId = threadRecords[0].id;
                    }

                    // Get the thread for our custom model
                    this.state.thread = this.threadService.getThread('mail.activity.thread', threadId);
                    await this.threadService.loadAround(this.state.thread);
                    this.state.threadRecord = threadId;

                    // Get comment count
                    if (this.state.thread && this.state.thread.messages) {
                        const validMessages = this.state.thread.messages.filter(
                            msg => msg && msg.body && msg.body.trim() !== ''
                        );
                        this.state.commentCount = validMessages.length;
                    }

                } catch (error) {
                    console.error("Failed to initialize activity message thread:", error);
                }
            }
        });

        onMounted(() => {
            this._checkSessionStorage();
            this._setupMessageListener();
        });
    },

    toggleComments() {
        this.state.showComments = !this.state.showComments;

        if (!this.state.showComments) {
            // Get comment count
            if (this.state.thread && this.state.thread.messages) {
                const validMessages = this.state.thread.messages.filter(
                    msg => msg && msg.body && msg.body.trim() !== ''
                );
                this.state.commentCount = validMessages.length;
            }
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
            // Create a reaction to track changes to thread messages
            this.threadMessagesReaction = () => {
                if (this.state.thread && this.state.thread.messages) {
                    const validMessages = this.state.thread.messages.filter(
                        msg => msg && msg.body && msg.body.trim() !== ''
                    );
                    this.state.commentCount = validMessages.length;
                }
            };

            // Set up initial count
            this.threadMessagesReaction();
        }
    },

    _checkSessionStorage() {
        try {
            // Check if we have stored thread info in session storage
            const storedInfo = sessionStorage.getItem('open_activity_comments');
            if (storedInfo) {
                const threadInfo = JSON.parse(storedInfo);

                // Check if this is for our message
                if (threadInfo &&
                    threadInfo.threadModel === 'mail.activity.thread' &&
                    threadInfo.activityDoneMessageId &&
                    threadInfo.activityDoneMessageId === this.props.message.id) {

                    // Open the comments section
                    if (!this.state.showComments) {
                        this.toggleComments();
                    }
                    // Scroll the message into view
                    this._scrollIntoView();
                    // Clear the storage so it doesn't keep opening
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
                    // attempt - look for message by class and content
                    const allMessages = document.querySelectorAll('.o-mail-Message');
                    for (const msg of allMessages) {
                        if (msg.textContent.includes(this.props.message.body) ||
                            msg.innerHTML.includes(this.props.message.body)) {
                            msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            return;
                        }
                    }

                    // Last resort - just scroll to the comments container
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

