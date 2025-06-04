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
            showPreview: false,
            previewUrl: null,
            editingCommentId: null,
            active: true,
        });

        this.markEventHandled = (ev, name) => {
            ev.stopPropagation();
        };

        // Add event handlers for textarea
        this.onKeydown = (ev) => {
            if (ev.key === 'Escape') {
                this.cancelEditComment();
            } else if (ev.key === 'Enter' && ev.ctrlKey) {
                this.saveEditComment();
            }
        };

        this.onFocusin = (ev) => {
            ev.stopPropagation();
        };

        this.onFocusout = (ev) => {
            ev.stopPropagation();
        };

        this.onPaste = (ev) => {
            ev.stopPropagation();
        };

        this.markDonePopover = usePopover(ActivityMarkAsDone, { position: "right" });
        this.avatarCard = usePopover(AvatarCardPopover);
        
        onWillStart(async () => {
            // Add early return if services aren't properly initialized
            if (!this.storeService || !this.orm || !this.busService || this.storeService.inPublicPage) {
                console.warn("Required services not properly initialized");
                return;
            }
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
            if (this.env.bus) {
                this.env.bus.addEventListener("activity_comment_posted", this._onActivityCommentPosted.bind(this));
            }
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
        } else if (this.commentRef && this.commentRef.el) {
            // Use setTimeout to ensure the DOM is updated before scrolling
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
        if (!this.state.thread) return;
        try {
            const messages = this.storeService.Message.records;
            const threadMessages = Object.values(messages).filter(
                msg =>
                    msg.thread &&
                    msg.thread.id === this.state.thread.id &&
                    msg.message_type === 'comment' &&
                    ((msg.body && msg.body.trim() !== '') || (msg.attachment_ids && msg.attachment_ids.length > 0))
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
                attachments: msg.attachments || [],
                editable: true,
            }));

            newComments.sort((a, b) => new Date(a.create_date) - new Date(b.create_date));
            this.state.comments.splice(0, this.state.comments.length, ...newComments);

            // Log for debugging
            console.log("[ActivityCommentPanel] Updated comments from store:", {
                messageCount: Object.keys(messages).length,
                threadMessageCount: threadMessages.length,
                commentCount: newComments.length,
                commentsWithAttachments: newComments.filter(c => c.attachments && c.attachments.length > 0).length
            });
        } catch (error) {
            console.error("[ActivityCommentPanel] Failed to update comments from store:", error);
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
                        ['id', 'body', 'author_id', 'email_from', 'create_date', 'message_type', 'attachment_ids']
                    );
                    if (this.__owl__ && this.__owl__.isDestroyed) return;
                }

                // Fetch attachment details for all messages
                const allAttachmentIds = [];
                for (const msg of messageObjs) {
                    if (msg.attachment_ids && msg.attachment_ids.length) {
                        allAttachmentIds.push(...msg.attachment_ids);
                    }
                }

                // Fetch attachment details in bulk
                let attachmentDetails = [];
                if (allAttachmentIds.length > 0) {
                    attachmentDetails = await this.orm.searchRead(
                        'ir.attachment',
                        [['id', 'in', allAttachmentIds]],
                        ['id', 'name', 'mimetype', 'url', 'access_token']
                    );
                }

                // Create a map of attachment details for quick lookup
                const attachmentMap = new Map(
                    attachmentDetails.map(att => [
                        att.id,
                        {
                            ...att,
                            url: att.access_token && att.access_token !== 'false' && att.access_token !== false && att.access_token !== undefined && att.access_token !== null
                                ? `/web/content/${att.id}?access_token=${att.access_token}`
                                : `/web/content/${att.id}`
                        }
                    ])
                );

                // Process messages and include attachments
                for (const message of messageObjs) {
                    const attachments = message.attachment_ids
                        ? message.attachment_ids.map(id => attachmentMap.get(id)).filter(Boolean)
                        : [];
                    
                    this.storeService.Message.insert({
                        ...message,
                        thread: this.state.thread,
                        attachments: attachments
                    });
                }

                const threadMessages = messageObjs.filter(
                    msg => ((msg.body && msg.body.trim() !== '') || (msg.attachment_ids && msg.attachment_ids.length > 0)) && msg.message_type === 'comment'
                );

                const newComments = threadMessages.map(msg => {
                    const attachments = msg.attachment_ids
                        ? msg.attachment_ids.map(id => attachmentMap.get(id)).filter(Boolean)
                        : [];

                    return {
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
                        attachments: attachments
                    };
                });

                newComments.sort((a, b) => new Date(a.create_date) - new Date(b.create_date));
                this.state.comments.splice(0, this.state.comments.length, ...newComments);
                this.state.commentCount = newComments.length;

                if (this.state.showComments && this.commentRef.el) {
                    this.commentRef.el.scrollTop = this.commentRef.el.scrollHeight;
                }

                // Log for debugging
                console.log("[ActivityCommentPanel] Updated comments with attachments:", {
                    messageCount: messageObjs.length,
                    commentCount: newComments.length,
                    commentsWithAttachments: newComments.filter(c => c.attachments && c.attachments.length > 0).length,
                    sampleComment: newComments[0]
                });
            }
        } catch (error) {
            console.error("[ActivityCommentPanel] Failed to fetch and hydrate comments:", error);
        }
    },

    showImagePreview(ev) {
        const url = ev.target.src;
        this.state.previewUrl = url;
        this.state.showPreview = true;
    },

    closePreview() {
        this.state.showPreview = false;
        this.state.previewUrl = null;
    },

    async removeAttachment(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const attId = ev.target.closest('[data-id]').dataset.id;
        try {
            await this.orm.unlink('ir.attachment', [parseInt(attId)]);
            await this._fetchAndHydrateComments && this._fetchAndHydrateComments();
            this.render && this.render();
        } catch (error) {
            console.error('Failed to delete attachment:', error);
        }
    },

    preventBubble() {
        // Kosong, hanya untuk mencegah bubbling event click pada gambar preview
    },

    editComment(ev) {
        const commentId = ev.target.closest('[data-id]').dataset.id;
        const comment = this.state.comments.find(c => String(c.id) === String(commentId));
        if (comment) {
            this.state.editingCommentId = commentId;
        }
        this.render && this.render();
    },

    async saveEditComment() {
        const commentId = this.state.editingCommentId;
        let newBody = this.state.editingComposer ? this.state.editingComposer.textInput : '';
        if (!/^<p>.*<\/p>$/.test(newBody.trim())) {
            newBody = `<p>${newBody.trim()}</p>`;
        }
        try {
            await this.orm.write('mail.message', [parseInt(commentId)], { body: newBody });
            const comment = this.state.comments.find(c => String(c.id) === String(commentId));
            if (comment) {
                comment.body = markup(newBody);
            }
        } catch (error) {
            console.error('Failed to save comment:', error);
        }
        this.state.editingCommentId = null;
        this.state.editingComposer = null;
        this.render && this.render();
    },

    cancelEditComment() {
        this.state.editingCommentId = null;
        this.state.editingComposer = null;
        this.render && this.render();
    },

    deleteComment(ev) {
        const commentId = ev.target.closest('[data-id]').dataset.id;
        const threadId = this.state.thread ? this.state.thread.id : null;
        console.log('Delete comment', commentId, 'in thread', threadId);
        // TODO: Implementasi hapus per thread
    },

    copyLink(ev) {
        const commentId = ev.target.closest('[data-id]').dataset.id;
        const threadId = this.state.thread ? this.state.thread.id : null;
        const url = `${window.location.origin}${window.location.pathname}?thread=${threadId}&comment=${commentId}`;
        navigator.clipboard.writeText(url).then(() => {
            console.log('Link copied:', url);
        }, (err) => {
            console.error('Failed to copy link:', err);
        });
    },

    // Handler to start editing a comment
    onEditComment(comment) {
        this.state.editingCommentId = comment.id;
        this.state.editingComposer = this.storeService.Composer.insert({
            thread: this.state.thread,
            type: 'note',
            mode: 'extended',
            message: parseInt(comment.id),
            res_id: parseInt(comment.id),
            res_model: 'mail.message',
            onDiscardCallback: this.cancelEditComment.bind(this),
        });
        this.state.editingComposer.textInput = stripHtmlTags(comment.body) || '';
        this.render && this.render();
    },
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

function stripHtmlTags(html) {
    // Menghapus semua tag HTML, khususnya <p>
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}