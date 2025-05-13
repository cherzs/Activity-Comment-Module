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
            'activity_comment/static/src/components/**/*.js',
            'activity_comment/static/src/components/**/*.xml',
            'activity_comment/static/src/components/**/*.scss',
        ],
    },
    'installable': True,
    'auto_install': False,
    'application': False,
    'license': 'LGPL-3',
} 