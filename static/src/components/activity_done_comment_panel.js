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

// First patch the base Message component to handle rpc service
patch(Message.prototype, {
    setup() {
        super.setup();
        this.store = useService("mail.store");
        
        // Only initialize rpc service if we're in a private context
        if (!this.store.inPublicPage) {
            try {
                this.rpc = useService("rpc");
            } catch (error) {
                console.warn("RPC service not available:", error);
                this.rpc = null;
            }
        }
    }
});

// Then patch our specific implementation
patch(Message.prototype, {
    setup() {
        super.setup();
        this.state = useState({
            showComments: false,
            thread: null,
            threadRecord: null,
            commentCount: 0,
            texts: {
                addComment: _t(" Add a Comment"),
                hideComments: _t(" Hide Comments"),
                seeComments: _t(" See Comments"),
                addCommentPlaceholder: _t("Add a Comment...")
            }
        });

        this.commentRef = useRef('commentPanel');
        this.orm = useService("orm");
        this.store = useService("mail.store");

        // Initialize mail services
        this.threadService = null;
        if (!this.store.inPublicPage) {
            try {
                this.threadService = useService("mail.thread");
            } catch (error) {
                console.warn("Mail services not available:", error);
            }
        }

        onWillStart(async () => {
            if (!this.threadService) {
                console.warn("Thread service not available, comments functionality will be disabled");
                return;
            }

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
                        const newThreadIds = await this.orm.create('mail.activity.thread', [{
                            activity_done_message_id: this.props.message.id,
                            res_model: this.props.message.model,
                            res_id: this.props.message.res_id,
                        }]);
                        threadId = newThreadIds[0];
                    } else {
                        threadId = threadRecords[0].id;
                    }

                    if (this.threadService) {
                        this.state.thread = this.threadService.getThread('mail.activity.thread', threadId);
                        await this.threadService.loadAround(this.state.thread);
                        this.state.threadRecord = threadId;

                        if (this.state.thread && this.state.thread.messages) {
                            const validMessages = this.state.thread.messages.filter(
                                msg => msg && msg.body && msg.body.trim() !== ''
                            );
                            this.state.commentCount = validMessages.length;
                        }
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

