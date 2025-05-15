from odoo import models, fields, api


class ActivityThread(models.Model):
    _name = 'mail.activity.thread'
    _description = 'Activity Thread for Comments'
    _inherit = ['mail.thread']
    _mail_post_access = 'read'
    _mail_create_nolog = True

    activity_id = fields.Many2one(
        'mail.activity',
        string='Related Activity',
        required=False,  # No longer required as activity might be completed
        ondelete='set null',  # Don't delete thread when activity is done
        index=True
    )

    # Store the resulting message when activity is completed
    activity_done_message_id = fields.Many2one(
        'mail.message',
        string='Activity Done Message',
        help='Message created when activity was marked as done',
        index=True
    )

    res_model = fields.Char(string='ResModel')
    res_id = fields.Char(string='ResId')

    name = fields.Char(string='Name')

    # Make sure when an activity is deleted, its thread is deleted as well
    @api.model_create_multi
    def create(self, vals_list):
        # Create with context to prevent automatic subscription
        ctx = dict(self.env.context,
                   mail_create_nosubscribe=True,  # Don't auto-subscribe creator
                   mail_create_nolog=True)  # Don't log creation
        self = self.with_context(ctx)

        # Check for any temporary IDs and remove them
        for vals in vals_list:
            if 'id' in vals and isinstance(vals['id'], int) and vals['id'] < 0:
                del vals['id']
                
        records = super().create(vals_list)
        for record in records:
            # Set the name based on the activity
            if record.activity_id:
                record.message_subscribe(partner_ids=[record.activity_id.user_id.partner_id.id])
                record.name = record.activity_id.display_name
            if record.activity_done_message_id:
                record.message_subscribe(partner_ids=[record.activity_id.user_id.partner_id.id])
                record.name = record.activity_done_message_id.description
        return records

    # Method to link activity thread to the done message when activity is completed
    def update_done_activity(self, thread_id, message_id):
        """Update thread when activity is marked as done"""
        thread = self.search([('id', '=', thread_id)], limit=1)
        if thread:
            thread.write({
                'activity_id': False,  # Clear activity reference as it's deleted
                'activity_done_message_id': message_id,  # Link to the created message
            })
            return thread
        return False

    @api.model
    def transfer_thread_from_message_to_activity(self, message_id, activity_id):
        """Transfer a thread from a completed activity message to a new temporary activity

        This is used during edit flow when a completed activity is being edited.

        Args:
            message_id: ID of the completed activity message
            activity_id: ID of the new temporary activity

        Returns:
            The updated thread record
        """
        # Find the thread linked to the message
        thread = self.search([('activity_done_message_id', '=', message_id)], limit=1)
        if thread:
            # Transfer it to the new activity
            thread.write({
                'activity_id': activity_id,  # Link to the new activity
            })
            return thread
        return False
        
    def message_post(self, **kwargs):
        """Overridden message_post to handle activity threads specially
        
        This ensures comments are properly attached to the thread
        and handled correctly for both active activities and done activities.
        """
        self.ensure_one()
        
        # Add the proper field names to the context to ensure message properties are set correctly
        context = dict(self.env.context)
        if self.activity_id:
            context.update({
                'mail_activity_thread_id': self.id,
                'mail_activity_id': self.activity_id.id,
            })
        elif self.activity_done_message_id:
            context.update({
                'mail_activity_thread_id': self.id,
                'mail_activity_done_message_id': self.activity_done_message_id.id,
            })
            
        # Add subtype if not specified
        if 'subtype_xmlid' not in kwargs and 'subtype_id' not in kwargs:
            kwargs['subtype_xmlid'] = 'mail.mt_note'
        
        # Log for diagnostic purposes
        _logger = self.env.ref('base.logging_backend').sudo()
        
        try:
            # Post with context
            message = super(ActivityThread, self.with_context(context)).message_post(**kwargs)
            
            # Log successful posting
            _logger.info(
                f"Successfully posted message to thread {self.id}, message ID: {message.id}",
                exc_info=True
            )
            
            return message
            
        except Exception as e:
            # Log failure
            _logger.error(
                f"Failed to post message to thread {self.id}. Error: {str(e)}",
                exc_info=True
            )
            # Re-raise the exception
            raise