fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'unova_dashboard_bridge'
author 'UNC Customs / Jack Hodgy'
description 'Unova Management Dashboard bridge for FiveM status and moderation sync'
version '1.0.0'

ui_page 'html/index.html'
loadscreen 'html/loading.html'
loadscreen_cursor 'yes'

files {
    'html/index.html',
    'html/style.css',
    'html/app.js',
    'html/loading.html',
    'html/loading.css'
}

client_script 'client.lua'
server_script 'server.lua'
