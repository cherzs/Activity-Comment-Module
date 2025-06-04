from odoo import models, api

class IrAttachment(models.Model):
    _inherit = 'ir.attachment'

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            # if payload contains thread_id and thread_model, set res_model and res_id
            thread_id = vals.pop('thread_id', None)
            thread_model = vals.pop('thread_model', None)
            if thread_id and thread_model:
                vals['res_model'] = thread_model
                vals['res_id'] = int(thread_id)
        return super().create(vals_list) 