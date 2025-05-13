{
    'name': 'Activity Comments',
    'version': '1.0',
    'category': 'Productivity',
    'summary': 'Add comments to activities',
    'description': """
    'website': "https://www.doodex.net/",
Activity Comments
================
This module allows users to add comments to activities.
Comments can be added, resolved, and managed within activities.
    """,
    'depends': ['mail'],
    'data': [
        'security/ir.model.access.csv',
    ],
    'images': ['static/description/banner.png',],
    'assets': {
        'web.assets_backend': [
            'Activity-Comment-Module/static/src/components/models.js',
            'Activity-Comment-Module/static/src/components/activity_comment_panel.js',
            'Activity-Comment-Module/static/src/components/activity_done_comment_panel.js',
            'Activity-Comment-Module/static/src/components/messaging_menu.js',
            'Activity-Comment-Module/static/src/components/activity.xml',
            'Activity-Comment-Module/static/src/components/message.xml',
        ],
    },
    'installable': True,
    'auto_install': False,
    'application': False,
    'license': 'LGPL-3',
} 