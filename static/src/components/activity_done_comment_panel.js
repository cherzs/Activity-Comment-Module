/** @odoo-module **/
import { Message } from "@mail/core/common/message";
import { patch } from "@web/core/utils/patch";
import { useState, useRef, onWillStart, onMounted, onWillUnmount, effect } from "@odoo/owl";
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

// patch(Message, {
//     components: Object.assign({}, Message.components, { Thread, Composer })
// });

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
        
        // Initialize all services first
        this.storeService = useService("mail.store");
        this.orm = useService("orm");
        this.busService = useService("bus_service");
        
        // Initialize state
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
            showPreview: false,
            previewUrl: null,
            previewName: '',
            editingCommentId: null,
            active: true,
        });

        this.commentRef = useRef('commentPanel');

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

        this.markEventHandled = (ev, name) => {
            ev.stopPropagation();
        };

        onWillStart(async () => {
            // Add early return if services aren't properly initialized
            if (!this.storeService || !this.orm || !this.busService || this.storeService.inPublicPage) {
                console.warn("Required services not properly initialized");
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
                    // if (!thread.composer) {
                    //     thread.composer = this.storeService.Composer.insert({
                    //         thread: thread,
                    //         type: 'note',
                    //         mode: 'extended'
                    //     });
                    // }
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
                            editable: true,
                        }));
                        this.state.comments.splice(0, this.state.comments.length, ...newComments);
                        this.state.comments.sort((a, b) => new Date(a.create_date) - new Date(b.create_date));
                        this._updateCommentCount();
                    }
                    this._updateCommentsFromStore();
                } catch (error) {
                    // console.error("Failed to initialize activity thread:", error);
                }
            }
        });

        onMounted(() => {
            this._checkSessionStorage();
            this._setupBusListeners();
            this.env.bus.addEventListener("activity_comment_posted", this._onActivityCommentPosted.bind(this));
        });

        onWillUnmount(() => {
            if (this.threadMessagesReaction) {
                this.threadMessagesReaction();
            }
            if (this.busService) {
                this.busService.removeEventListener("notification", this._onBusNotification);
            }
            this.env.bus.removeEventListener("activity_comment_posted", this._onActivityCommentPosted.bind(this));
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
        
        // Use setTimeout to ensure the DOM is updated before scrolling
        if (this.state.showComments) {
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
                            ((msg.body && msg.body.trim() !== '') || (msg.attachment_ids && msg.attachment_ids.length > 0))
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
                        formattedDate: formatDatetimeOdoo(msg.create_date),
                        attachments: msg.attachments || [],
                        editable: true,
                    }));
                    
                    // Sort comments by date
                    newComments.sort((a, b) => new Date(a.create_date) - new Date(b.create_date));
                    
                    // Update state.comments while preserving reactivity
                    this.state.comments.splice(0, this.state.comments.length, ...newComments);
                    
                    // Log for debugging
                    console.log("[ActivityDoneCommentPanel] Updated comments from message listener:", {
                        messageCount: Object.keys(messages).length,
                        threadMessageCount: threadMessages.length,
                        commentCount: newComments.length,
                        commentsWithAttachments: newComments.filter(c => c.attachments && c.attachments.length > 0).length
                    });
                    
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
            // console.error("Error checking session storage:", error);
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
            // console.error("Error scrolling message into view:", error);
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

    _onActivityCommentPosted(ev) {
        const { threadId, threadModel } = ev.detail;
        if (this.state.thread && this.state.thread.id === threadId && this.state.thread.model === threadModel) {
            this._updateCommentsFromStore();
        }
    },

    async _updateCommentsFromStore() {
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
                        attachments: attachments,
                        editable: true,
                    };
                });

                newComments.sort((a, b) => new Date(a.create_date) - new Date(b.create_date));
                this.state.comments.splice(0, this.state.comments.length, ...newComments);
                this.state.commentCount = newComments.length;

                if (this.state.showComments && this.commentRef.el) {
                    this.commentRef.el.scrollTop = this.commentRef.el.scrollHeight;
                }

                // Log for debugging
                console.log("[ActivityDoneCommentPanel] Updated comments with attachments:", {
                    messageCount: messageObjs.length,
                    commentCount: newComments.length,
                    commentsWithAttachments: newComments.filter(c => c.attachments && c.attachments.length > 0).length,
                    sampleComment: newComments[0]
                });
            }
        } catch (error) {
            console.error("[ActivityDoneCommentPanel] Failed to update comments from store:", error);
        }
    },

    showImagePreview(ev) {
        const url = ev.target.src;
        const name = ev.target.getAttribute('data-name') || '';
        this.state.previewUrl = url;
        this.state.previewName = name;
        this.state.showPreview = true;
    },

    closePreview() {
        this.state.showPreview = false;
        this.state.previewUrl = null;
        this.state.previewName = '';
    },

    async removeAttachment(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const attId = ev.target.closest('[data-id]').dataset.id;
        try {
            await this.orm.unlink('ir.attachment', [parseInt(attId)]);
            await this._updateCommentsFromStore && this._updateCommentsFromStore();
            this.render && this.render();
        } catch (error) {
            console.error('Failed to delete attachment:', error);
        }
    },

    preventBubble() {
        // Empty, only to prevent click event on image preview
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
        try {
            await this.orm.write('mail.message', [parseInt(commentId)], { body: this.state.editingComposer.textInput });
            const comment = this.state.comments.find(c => String(c.id) === String(commentId));
            if (comment) {
                comment.body = this.state.editingComposer.textInput;
            }
        } catch (error) {
            console.error('Failed to save comment:', error);
        }
        this.state.editingCommentId = null;
        this.render && this.render();
    },

    cancelEditComment() {
        this.state.editingCommentId = null;
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