/** @odoo-module **/

import { Activity } from "@mail/core/web/activity";
import { patch } from "@web/core/utils/patch";
import { useState, useRef, onWillStart, onMounted } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Thread } from "@mail/core/common/thread";
import { Composer } from "@mail/core/common/composer";
import { _t } from "@web/core/l10n/translation";

// Patch the Activity component to add Thread to its components
patch(Activity, {
    components: Object.assign({}, Activity.components, { Thread, Composer })
});

// First patch the base Activity component to handle mail services
patch(Activity.prototype, {
    setup() {
        super.setup();
        this.store = useService("mail.store");
        
        // Only initialize mail services if we're in a private context
        if (!this.store.inPublicPage) {
            try {
                this.threadService = useService("mail.thread");
            } catch (error) {
                console.warn("Mail services not available:", error);
                this.threadService = null;
            }
        }
    }
});

// Then patch our specific implementation
patch(Activity.prototype, {
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

        onWillStart(async () => {
            if (this.props.data && 
                this.props.data.id && 
                !this.store.inPublicPage && 
                this.threadService) {
                try {
                    // Check if a thread record exists for this activity
                    const threadRecords = await this.orm.searchRead(
                        'mail.activity.thread',
                        [['activity_id', '=', this.props.data.id]],
                        ['id']
                    );

                    let threadId;

                    if (threadRecords.length === 0) {
                        // Create a new thread record if none exists
                        // orm.create returns an array of IDs, take the first one
                        const newThreadIds = await this.orm.create('mail.activity.thread', [{
                            activity_id: this.props.data.id,
                            res_model: this.props.data.res_model,
                            res_id: this.props.data.res_id,
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
                    console.error("Failed to initialize activity thread:", error);
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

                // Check if this is for our activity
                if (threadInfo &&
                    threadInfo.threadModel === 'mail.activity.thread' &&
                    threadInfo.activityId &&
                    threadInfo.activityId === this.props.data.id) {

                    // Open the comments section
                    if (!this.state.showComments) {
                        this.toggleComments();
                    }

                    // Clear the storage so it doesn't keep opening
                    sessionStorage.removeItem('open_activity_comments');
                }
            }
        } catch (error) {
            console.error("Error checking session storage:", error);
        }
    }
});
