# Activity Comments

This module adds the ability to add comments to mail activities in Odoo. It provides a simple, straightforward commenting system for activities.

## Features

- Add comments to activities
- Thread-based discussion within activities
- Keeps a history of all comments per activity

## Usage

1. Install the module
2. Navigate to any view that has activities (e.g., Leads in CRM)
3. Open the activity view
4. Each activity card will have an "Add Comment" button
5. Click on the button to add a new comment
6. Comments are displayed in chronological order

## Technical Details

The module creates a new model `mail.activity.thread` that links comments to activities. It leverages the mail thread system to provide a familiar commenting experience consistent with the rest of Odoo. 