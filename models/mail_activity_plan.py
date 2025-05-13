from odoo import models, fields, api
from collections import defaultdict
from datetime import datetime, timedelta
import pytz
from dateutil.rrule import rrulestr
from odoo.tools import logging

_logger = logging.getLogger(__name__)


class MailActivity(models.Model):
    _inherit = 'mail.activity'

    def _action_done(self, feedback=False, attachment_ids=None):
        """Override to link activity threads to done messages."""

        # Get activity IDs and their related record info before deletion
        activity_ids = self.ids
        activity_record_map = {activity.id: (activity.res_model, activity.res_id) for activity in self}

        # Fetch all related threads before the activities are archived/deleted
        threads = self.env['mail.activity.thread'].search([('activity_id', 'in', activity_ids)])

        # Map thread.id -> activity_id
        thread_to_activity = {thread.id: thread.activity_id.id for thread in threads}

        # Call super to execute original logic
        messages, next_activities = super()._action_done(
            feedback=feedback,
            attachment_ids=attachment_ids
        )

        # Link messages to threads if applicable
        if messages and threads:
            # Map (model, res_id) -> message_id
            message_map = {(msg.model, msg.res_id): msg.id for msg in messages}

            for thread in threads:
                activity_id = thread_to_activity.get(thread.id)
                if not activity_id:
                    continue

                model_res = activity_record_map.get(activity_id)
                if not model_res:
                    continue

                message_id = message_map.get(model_res)
                if message_id:
                    thread.update_done_activity(thread.id, message_id)

        return messages, next_activities

    def unlink(self):
        """Override to ensure threads aren't left dangling if a temp activity is deleted"""
        # This is important for handling discarded edits
        thread_model = self.env['mail.activity.thread']

        # Find threads linked to these activities that are being edited
        threads = thread_model.search([
            ('activity_id', 'in', self.ids)
        ])

        # For each thread, remove activity_id
        for thread in threads:
            # Only remove activity_id threads that have an original message
            if thread.activity_done_message_id:
                thread.write({
                    'activity_id': False
                })

        return super(MailActivity, self).unlink()