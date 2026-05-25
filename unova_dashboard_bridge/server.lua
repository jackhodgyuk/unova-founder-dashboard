local RAW_DASHBOARD_URL = GetConvar('unova_dashboard_url', 'https://unova-founder-dashboard-git-597032418775.europe-west1.run.app')
local API_KEY = GetConvar('unova_dashboard_key', 'change_this_fivem_secret')

local function normalizeDashboardUrl(value)
    local normalized = tostring(value or '')
    normalized = normalized:gsub('%s+', '')
    normalized = normalized:gsub('/+$', '')
    normalized = normalized:gsub('/dashboard$', '')
    return normalized
end

local DASHBOARD_URL = normalizeDashboardUrl(RAW_DASHBOARD_URL)
local API_KEY_CONFIGURED = API_KEY ~= '' and API_KEY ~= 'change_this_fivem_secret'
local connectingQueue = {}
local queueSerial = 0

local function apiUrl(path)
    return DASHBOARD_URL .. path
end

local function urlEncode(value)
    return tostring(value or ''):gsub('([^%w%-_%.~])', function(char)
        return string.format('%%%02X', string.byte(char))
    end)
end

local function removeQueueEntry(src)
    for index = #connectingQueue, 1, -1 do
        if connectingQueue[index].src == src then
            table.remove(connectingQueue, index)
        end
    end
end

local function sortQueue()
    table.sort(connectingQueue, function(a, b)
        if a.priority ~= b.priority then
            return a.priority > b.priority
        end
        return a.joinedAt < b.joinedAt
    end)
end

local function queuePosition(src)
    sortQueue()
    for index, entry in ipairs(connectingQueue) do
        if entry.src == src then return index end
    end
    return 1
end

local function fetchPriority(discordId, cb)
    if not discordId then
        cb({ points = 0, label = 'Standard Queue' })
        return
    end

    PerformHttpRequest(apiUrl('/fivem/priority/check?discordId=' .. urlEncode(discordId)), function(status, body)
        if status ~= 200 or not body then
            cb({ points = 0, label = 'Standard Queue' })
            return
        end

        local data = json.decode(body)
        local priority = data and data.priority or {}
        cb({
            points = tonumber(priority.points or 0) or 0,
            label = priority.label or 'Standard Queue'
        })
    end, 'GET', '', { ['x-api-key'] = API_KEY })
end

local function logHttpFailure(label, status, body, errorData)
    print(('[Unova Dashboard] %s failed: status=%s url=%s error=%s body=%s'):format(
        label,
        tostring(status),
        DASHBOARD_URL,
        tostring(errorData or 'none'),
        tostring(body or '')
    ))
end

local function startsWith(value, prefix)
    return string.sub(value, 1, #prefix) == prefix
end

local function getIdentifier(src, prefix)
    for _, identifier in ipairs(GetPlayerIdentifiers(src)) do
        if startsWith(identifier, prefix) then
            return identifier
        end
    end
    return nil
end

local function getLicense(src)
    return getIdentifier(src, 'license:')
end

local function getDiscordId(src)
    local identifier = getIdentifier(src, 'discord:')
    if not identifier then return nil end
    return string.sub(identifier, 9)
end

local function hasLocalAdminAccess(src)
    if src == 0 then return true end
    return GetConvar('unova_allow_ace_admin', 'false') == 'true' and IsPlayerAceAllowed(src, 'unova.admin')
end

local function checkAdminAccess(src, cb)
    if hasLocalAdminAccess(src) then
        cb(true)
        return
    end

    local discordId = getDiscordId(src)
    if not discordId then
        cb(false)
        return
    end

    PerformHttpRequest(apiUrl('/fivem/access/check?discordId=' .. urlEncode(discordId)), function(status, body)
        if status ~= 200 or not body then
            cb(false)
            return
        end

        local data = json.decode(body)
        cb(data and data.allowed == true)
    end, 'GET', '', { ['x-api-key'] = API_KEY })
end

local function checkLeadershipAccess(src, cb)
    local discordId = getDiscordId(src)
    if not discordId then
        cb(false)
        return
    end

    PerformHttpRequest(apiUrl('/fivem/leadership/check?discordId=' .. urlEncode(discordId)), function(status, body)
        if status ~= 200 or not body then
            cb(false)
            return
        end

        local data = json.decode(body)
        cb(data and data.allowed == true)
    end, 'GET', '', { ['x-api-key'] = API_KEY })
end

local function fetchTickets(cb)
    PerformHttpRequest(apiUrl('/fivem/tickets'), function(status, body)
        if status ~= 200 or not body then
            cb({})
            return
        end
        local data = json.decode(body)
        cb(data and data.tickets or {})
    end, 'GET', '', { ['x-api-key'] = API_KEY })
end

local function getPlayerInfo(playerId)
    local player = tostring(playerId)
    local name = GetPlayerName(player)
    if not name then return nil end

    return {
        id = tonumber(player),
        name = name,
        ping = GetPlayerPing(player),
        license = getLicense(player),
        discordId = getDiscordId(player)
    }
end

local function getPlayerList()
    local players = {}
    for _, playerId in ipairs(GetPlayers()) do
        local info = getPlayerInfo(playerId)
        if info then
            table.insert(players, info)
        end
    end
    return players
end

local function notifyAdmin(src, message, ok)
    TriggerClientEvent('unova:admin:notice', src, {
        message = message,
        ok = ok == true
    })
    TriggerClientEvent('chat:addMessage', src, {
        args = {'Unova Management', message}
    })
end

local function notifyInEyes(src, title, message)
    TriggerClientEvent('unova:admin:eyesNotice', src, {
        title = title or 'Unova',
        message = message or ''
    })
end

local function sendStatus()
    local players = getPlayerList()

    PerformHttpRequest(apiUrl('/fivem/update'), function(status, body, _, errorData)
        if status ~= 200 then
            logHttpFailure('Status update', status, body, errorData)
        end
    end, 'POST', json.encode({
        serverName = GetConvar('sv_projectName', 'Unova'),
        onlinePlayers = #players,
        maxPlayers = GetConvarInt('sv_maxclients', 64),
        players = players
    }), {
        ['Content-Type'] = 'application/json',
        ['x-api-key'] = API_KEY
    })
end

local function findPlayerForAction(action)
    if action.playerId and GetPlayerName(tostring(action.playerId)) then
        return tostring(action.playerId)
    end

    if action.discordId then
        for _, playerId in ipairs(GetPlayers()) do
            if getDiscordId(playerId) == tostring(action.discordId) then
                return playerId
            end
        end
    end

    if action.license then
        for _, playerId in ipairs(GetPlayers()) do
            if getLicense(playerId) == action.license then
                return playerId
            end
        end
    end

    return nil
end

local function pollModeration()
    PerformHttpRequest(apiUrl('/fivem/moderation/poll'), function(status, body, _, errorData)
        if status ~= 200 or not body then
            if status ~= 200 then
                logHttpFailure('Moderation poll', status, body, errorData)
            end
            return
        end
        local data = json.decode(body)
        if not data or not data.actions then return end

        for _, action in ipairs(data.actions) do
            local reason = action.reason or 'No reason provided'
            local target = findPlayerForAction(action)

            if action.action == 'warn' and target then
                local ticketName = action.ticket and action.ticket.name or 'your golden lottery ticket'
                notifyInEyes(target, 'Golden Lottery Ticket', ('You have received a warning: %s. Please respond to %s in Discord.'):format(reason, ticketName))
            elseif action.action == 'kick' and target then
                DropPlayer(target, 'Kicked from Unova: ' .. reason)
            elseif action.action == 'ban' and target then
                DropPlayer(target, 'Banned from Unova: ' .. reason)
            end
        end
    end, 'GET', '', { ['x-api-key'] = API_KEY })
end

local function pollCityNotifications()
    PerformHttpRequest(apiUrl('/fivem/notifications/poll'), function(status, body, _, errorData)
        if status ~= 200 or not body then
            if status ~= 200 then
                logHttpFailure('Notification poll', status, body, errorData)
            end
            return
        end

        local data = json.decode(body)
        if not data or not data.notifications then return end

        for _, notification in ipairs(data.notifications) do
            for _, playerId in ipairs(GetPlayers()) do
                local target = tonumber(playerId)
                checkAdminAccess(target, function(allowed)
                    if allowed then
                        notifyInEyes(target, 'Unova Management', notification.message or 'New player report in Discord.')
                    end
                end)
            end
        end
    end, 'GET', '', { ['x-api-key'] = API_KEY })
end

local function openAdminPanel(src)
    if src == 0 then
        print('[Unova Management] /adminui can only be opened in-game.')
        return
    end

    checkAdminAccess(src, function(allowed)
        if not allowed then
            TriggerClientEvent('chat:addMessage', src, {
                args = {'Unova Management', 'Management only.'}
            })
            return
        end

        checkLeadershipAccess(src, function(leadership)
            if leadership then
                fetchTickets(function(tickets)
                    TriggerClientEvent('unova:admin:openPanel', src, getPlayerList(), tickets)
                end)
            else
                TriggerClientEvent('unova:admin:openPanel', src, getPlayerList(), {})
            end
        end)
    end)
end

RegisterCommand('adminui', function(src)
    openAdminPanel(src)
end, false)

RegisterCommand('report', function(src)
    if src == 0 then
        print('[Unova Management] /report can only be opened in-game.')
        return
    end

    TriggerClientEvent('unova:admin:openReport', src, getPlayerList())
end, false)

RegisterCommand('founderui', function(src)
    if src ~= 0 then
        TriggerClientEvent('chat:addMessage', src, {
            args = {'Unova Management', 'Use /adminui. /founderui is now an alias.'}
        })
    end
    openAdminPanel(src)
end, false)

RegisterCommand('unovatest', function(src)
    local function reply(message, ok)
        if src == 0 then
            print('[Unova Dashboard] ' .. message)
            return
        end
        notifyAdmin(src, message, ok)
    end

    checkAdminAccess(src, function(allowed)
        if not allowed then
            TriggerClientEvent('chat:addMessage', src, {
                args = {'Unova Management', 'Management only.'}
            })
            return
        end

        reply(('Testing bridge URL %s | API key configured: %s'):format(DASHBOARD_URL, tostring(API_KEY_CONFIGURED)), true)

        PerformHttpRequest(apiUrl('/health'), function(status, body, _, errorData)
            if status == 200 then
                reply('Health check OK: ' .. tostring(body or ''), true)
            else
                reply(('Health check failed: status=%s error=%s body=%s'):format(tostring(status), tostring(errorData or 'none'), tostring(body or '')), false)
            end
        end, 'GET', '')

        PerformHttpRequest(apiUrl('/fivem/update'), function(status, body, _, errorData)
            if status == 200 then
                reply('FiveM API key test OK. Website should receive city players.', true)
            else
                reply(('FiveM API key test failed: status=%s error=%s body=%s'):format(tostring(status), tostring(errorData or 'none'), tostring(body or '')), false)
            end
        end, 'POST', json.encode({
            serverName = GetConvar('sv_projectName', 'Unova'),
            onlinePlayers = #getPlayerList(),
            maxPlayers = GetConvarInt('sv_maxclients', 64),
            players = getPlayerList()
        }), {
            ['Content-Type'] = 'application/json',
            ['x-api-key'] = API_KEY
        })
    end)
end, false)

RegisterNetEvent('unova:admin:refreshPlayers', function()
    local src = source
    checkAdminAccess(src, function(allowed)
        if not allowed then return end
        checkLeadershipAccess(src, function(leadership)
            if leadership then
                fetchTickets(function(tickets)
                    TriggerClientEvent('unova:admin:updatePlayers', src, getPlayerList(), tickets)
                end)
            else
                TriggerClientEvent('unova:admin:updatePlayers', src, getPlayerList(), {})
            end
        end)
    end)
end)

RegisterNetEvent('unova:admin:moderate', function(data)
    local src = source
    if type(data) ~= 'table' then return end

    checkAdminAccess(src, function(allowed)
        if not allowed then return end

        local action = tostring(data.action or '')
        if action ~= 'warn' and action ~= 'kick' and action ~= 'ban' then
            notifyAdmin(src, 'Invalid moderation action.', false)
            return
        end

        local targetId = tonumber(data.playerId)
        local targetInfo = targetId and getPlayerInfo(targetId) or nil
        if not targetInfo then
            notifyAdmin(src, 'That player is no longer online.', false)
            return
        end

        local reason = tostring(data.reason or '')
        if reason == '' then
            notifyAdmin(src, 'Reason is required.', false)
            return
        end

        local payload = {
            playerId = targetInfo.id,
            playerName = targetInfo.name,
            discordId = targetInfo.discordId,
            license = targetInfo.license,
            reason = reason,
            moderatorDiscordId = getDiscordId(src)
        }

        PerformHttpRequest(apiUrl('/fivem/admin/moderation/' .. action), function(status, body, _, errorData)
            if status == 200 then
                notifyAdmin(src, action .. ' submitted. Discord ticket opened if the bot has channel permissions.', true)
                TriggerClientEvent('unova:admin:updatePlayers', src, getPlayerList())
                return
            end

            notifyAdmin(src, 'Moderation request failed: ' .. tostring(status) .. ' ' .. tostring(errorData or body or ''), false)
        end, 'POST', json.encode(payload), {
            ['Content-Type'] = 'application/json',
            ['x-api-key'] = API_KEY
        })
    end)
end)

RegisterNetEvent('unova:report:submit', function(data)
    local src = source
    if type(data) ~= 'table' then return end

    local offenderId = tonumber(data.offenderPlayerId)
    local offenderInfo = offenderId and getPlayerInfo(offenderId) or nil
    if not offenderInfo then
        notifyInEyes(src, 'Golden Lottery Ticket', 'That city ID is not online right now.')
        return
    end

    local bodycamUrl = tostring(data.bodycamUrl or '')
    local description = tostring(data.description or '')
    if bodycamUrl == '' or description == '' then
        notifyInEyes(src, 'Golden Lottery Ticket', 'Bodycam and what happened are required.')
        return
    end

    local reporterInfo = getPlayerInfo(src)
    local payload = {
        reporterPlayerId = reporterInfo and reporterInfo.id or src,
        reporterName = reporterInfo and reporterInfo.name or GetPlayerName(src),
        reporterDiscordId = getDiscordId(src),
        offenderPlayerId = offenderInfo.id,
        offenderName = offenderInfo.name,
        offenderDiscordId = offenderInfo.discordId,
        bodycamUrl = bodycamUrl,
        description = description
    }

    PerformHttpRequest(apiUrl('/fivem/reports'), function(status, body, _, errorData)
        if status == 200 then
            notifyInEyes(src, 'Golden Lottery Ticket', 'Your golden lottery ticket has been opened in Discord.')
            return
        end
        notifyInEyes(src, 'Golden Lottery Ticket', 'Report failed. Please try again or contact staff.')
        logHttpFailure('Player report', status, body, errorData)
    end, 'POST', json.encode(payload), {
        ['Content-Type'] = 'application/json',
        ['x-api-key'] = API_KEY
    })
end)

AddEventHandler('playerConnecting', function(name, setKickReason, deferrals)
    local src = source
    local license = getLicense(src)
    local discordId = getDiscordId(src)

    deferrals.defer()
    Wait(0)
    deferrals.update('Unova Roleplay | Checking account, ban status, and priority...')

    if not license then
        deferrals.done('Could not read your FiveM license. Please restart FiveM and try again.')
        return
    end

    PerformHttpRequest(apiUrl('/fivem/bans/check?license=' .. urlEncode(license)), function(status, body)
        if status == 200 and body then
            local data = json.decode(body)
            if data and data.banned then
                deferrals.done('You are banned from Unova: ' .. (data.ban.reason or 'No reason provided'))
                return
            end
        end

        fetchPriority(discordId, function(priority)
            queueSerial = queueSerial + 1
            local entry = {
                src = src,
                name = name,
                discordId = discordId,
                priority = priority.points or 0,
                label = priority.label or 'Standard Queue',
                joinedAt = queueSerial
            }
            table.insert(connectingQueue, entry)

            CreateThread(function()
                local maxPlayers = GetConvarInt('sv_maxclients', 64)
                local startedAt = os.time()
                local releaseAt = startedAt + 2

                while true do
                    local position = queuePosition(src)
                    local online = #GetPlayers()
                    deferrals.update(('Unova Priority Queue | %s | Priority %s | Position %s | Online %s/%s'):format(
                        entry.label,
                        tostring(entry.priority),
                        tostring(position),
                        tostring(online),
                        tostring(maxPlayers)
                    ))

                    if position <= 1 and online < maxPlayers and os.time() >= releaseAt then
                        removeQueueEntry(src)
                        deferrals.update('Unova Roleplay | Priority accepted. Loading city...')
                        Wait(750)
                        deferrals.done()
                        return
                    end

                    if os.time() - startedAt > 180 then
                        removeQueueEntry(src)
                        deferrals.done('Connection queue timed out. Please reconnect to Unova.')
                        return
                    end

                    Wait(2500)
                end
            end)
        end)
    end, 'GET', '', { ['x-api-key'] = API_KEY })
end)

AddEventHandler('playerDropped', function()
    removeQueueEntry(source)
end)

CreateThread(function()
    Wait(1000)
    print(('[Unova Dashboard] Bridge loaded. URL=%s API key configured=%s access=Discord management role'):format(
        DASHBOARD_URL,
        tostring(API_KEY_CONFIGURED)
    ))
end)

CreateThread(function()
    while true do
        sendStatus()
        Wait(10000)
    end
end)

CreateThread(function()
    while true do
        pollModeration()
        Wait(3000)
    end
end)

CreateThread(function()
    while true do
        pollCityNotifications()
        Wait(5000)
    end
end)
