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
local spectateCaptureInFlight = {}
local SPECTATE_FRAME_INTERVAL_MS = 100
local UNOVA_LOGO_URL = GetConvar('unova_logo_url', 'https://r2.fivemanage.com/O8nsC8f5nKWaQAbWhOnvx/IMG_1324.PNG')
local UNOVA_DISCORD_URL = GetConvar('unova_discord_url', 'https://discord.gg/unova')
local UNOVA_SUPPORT_URL = GetConvar('unova_support_url', UNOVA_DISCORD_URL)

local function apiUrl(path)
    return DASHBOARD_URL .. path
end

local function cardText(value)
    local text = tostring(value or '')
    text = text:gsub('[\r\n]+', ' ')
    return text
end

local function formatWait(seconds)
    local safeSeconds = math.max(0, tonumber(seconds or 0) or 0)
    local minutes = math.floor(safeSeconds / 60)
    local remaining = safeSeconds % 60
    if minutes > 0 then
        return string.format('%dm %02ds', minutes, remaining)
    end
    return string.format('%ds', remaining)
end

local function priorityClass(label, points)
    local cleanLabel = cardText(label or 'Standard Queue')
    if cleanLabel == '' then cleanLabel = 'Standard Queue' end
    if tonumber(points or 0) > 0 then
        return cleanLabel
    end
    return 'Standard'
end

local function unovaQueueCard(entry, position, online, maxPlayers, waitedSeconds, status)
    local priorityPoints = tonumber(entry and entry.priority or 0) or 0
    local passenger = cardText(entry and entry.name or 'Player')
    local queueLabel = priorityClass(entry and entry.label, priorityPoints)
    local queueStatus = cardText(status or 'City queue active')

    return {
        type = 'AdaptiveCard',
        ['@context'] = 'http://schema.org/extensions',
        ['$schema'] = 'http://adaptivecards.io/schemas/adaptive-card.json',
        version = '1.3',
        backgroundImage = {
            url = UNOVA_LOGO_URL,
            fillMode = 'RepeatHorizontally',
            horizontalAlignment = 'Right',
            verticalAlignment = 'Center'
        },
        body = {
            {
                type = 'Container',
                style = 'emphasis',
                bleed = true,
                items = {
                    {
                        type = 'ColumnSet',
                        columns = {
                            {
                                type = 'Column',
                                width = 'auto',
                                items = {
                                    {
                                        type = 'Image',
                                        url = UNOVA_LOGO_URL,
                                        size = 'Small',
                                        style = 'Person',
                                        altText = 'Unova'
                                    }
                                }
                            },
                            {
                                type = 'Column',
                                width = 'stretch',
                                items = {
                                    {
                                        type = 'TextBlock',
                                        text = 'UNOVA ROLEPLAY',
                                        weight = 'Bolder',
                                        color = 'Accent',
                                        spacing = 'None'
                                    },
                                    {
                                        type = 'TextBlock',
                                        text = 'City Queue Active',
                                        size = 'Large',
                                        weight = 'Bolder',
                                        wrap = true,
                                        spacing = 'None'
                                    }
                                }
                            }
                        }
                    },
                    {
                        type = 'TextBlock',
                        text = queueStatus,
                        wrap = true,
                        isSubtle = true,
                        spacing = 'Medium'
                    }
                }
            },
            {
                type = 'TextBlock',
                text = 'CFX QUEUE   ->   UNOVA CITY',
                horizontalAlignment = 'Center',
                weight = 'Bolder',
                size = 'Medium',
                spacing = 'Medium'
            },
            {
                type = 'ColumnSet',
                separator = true,
                columns = {
                    {
                        type = 'Column',
                        width = 'stretch',
                        items = {
                            { type = 'TextBlock', text = 'Player', isSubtle = true, size = 'Small', spacing = 'None' },
                            { type = 'TextBlock', text = passenger, weight = 'Bolder', wrap = true, spacing = 'None' }
                        }
                    },
                    {
                        type = 'Column',
                        width = 'stretch',
                        items = {
                            { type = 'TextBlock', text = 'Queue Class', isSubtle = true, size = 'Small', spacing = 'None' },
                            { type = 'TextBlock', text = queueLabel, weight = 'Bolder', wrap = true, spacing = 'None' }
                        }
                    },
                    {
                        type = 'Column',
                        width = 'stretch',
                        items = {
                            { type = 'TextBlock', text = 'Priority Pts', isSubtle = true, size = 'Small', spacing = 'None' },
                            { type = 'TextBlock', text = tostring(priorityPoints), weight = 'Bolder', spacing = 'None' }
                        }
                    }
                }
            },
            {
                type = 'ColumnSet',
                separator = true,
                columns = {
                    {
                        type = 'Column',
                        width = 'stretch',
                        items = {
                            { type = 'TextBlock', text = 'Queue Position', isSubtle = true, size = 'Small', spacing = 'None' },
                            { type = 'TextBlock', text = tostring(position or 1), weight = 'Bolder', spacing = 'None' }
                        }
                    },
                    {
                        type = 'Column',
                        width = 'stretch',
                        items = {
                            { type = 'TextBlock', text = 'City Capacity', isSubtle = true, size = 'Small', spacing = 'None' },
                            { type = 'TextBlock', text = tostring(online or 0) .. ' / ' .. tostring(maxPlayers or 0), weight = 'Bolder', spacing = 'None' }
                        }
                    },
                    {
                        type = 'Column',
                        width = 'stretch',
                        items = {
                            { type = 'TextBlock', text = 'Waited', isSubtle = true, size = 'Small', spacing = 'None' },
                            { type = 'TextBlock', text = formatWait(waitedSeconds), weight = 'Bolder', spacing = 'None' }
                        }
                    }
                }
            },
            {
                type = 'TextBlock',
                text = 'Keep Discord and city life separate. Your queue will clear automatically when the city has space.',
                wrap = true,
                isSubtle = true,
                spacing = 'Medium'
            }
        },
        actions = {
            { type = 'Action.OpenUrl', title = 'Discord', url = UNOVA_DISCORD_URL },
            { type = 'Action.OpenUrl', title = 'Support', url = UNOVA_SUPPORT_URL }
        }
    }
end

local function presentQueueCard(deferrals, entry, position, online, maxPlayers, waitedSeconds, status)
    local card = unovaQueueCard(entry, position, online, maxPlayers, waitedSeconds, status)
    local ok = pcall(function()
        deferrals.presentCard(json.encode(card))
    end)

    if not ok then
        deferrals.update(('Unova Queue | %s | Position %s | Online %s/%s | Wait %s'):format(
            priorityClass(entry and entry.label, entry and entry.priority),
            tostring(position or 1),
            tostring(online or 0),
            tostring(maxPlayers or 0),
            formatWait(waitedSeconds)
        ))
    end
end

local function postSpectateFrame(sessionId, image, errorMessage)
    PerformHttpRequest(apiUrl('/fivem/spectate/frame'), function(status, body, _, errorData)
        spectateCaptureInFlight[tostring(sessionId)] = nil
        if status ~= 200 then
            print(('[Unova Dashboard] Spectate frame failed: status=%s error=%s body=%s'):format(tostring(status), tostring(errorData or 'none'), tostring(body or '')))
        end
    end, 'POST', json.encode({
        sessionId = sessionId,
        image = image,
        error = errorMessage
    }), {
        ['Content-Type'] = 'application/json',
        ['x-api-key'] = API_KEY
    })
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

local function fetchTicketMessages(src, channelId, cb)
    local discordId = getDiscordId(src)
    if not discordId then
        cb(nil, 'Your Discord is not linked in FiveM.')
        return
    end

    PerformHttpRequest(apiUrl('/fivem/tickets/' .. urlEncode(channelId) .. '/messages?discordId=' .. urlEncode(discordId)), function(status, body, _, errorData)
        if status ~= 200 or not body then
            cb(nil, ('Ticket read failed: %s %s'):format(tostring(status), tostring(errorData or body or '')))
            return
        end

        cb(json.decode(body), nil)
    end, 'GET', '', { ['x-api-key'] = API_KEY })
end

local function sendTicketMessage(src, channelId, message, cb)
    local discordId = getDiscordId(src)
    if not discordId then
        cb(nil, 'Your Discord is not linked in FiveM.')
        return
    end

    PerformHttpRequest(apiUrl('/fivem/tickets/' .. urlEncode(channelId) .. '/messages'), function(status, body, _, errorData)
        if status ~= 200 or not body then
            cb(nil, ('Ticket reply failed: %s %s'):format(tostring(status), tostring(errorData or body or '')))
            return
        end

        cb(json.decode(body), nil)
    end, 'POST', json.encode({
        discordId = discordId,
        authorName = GetPlayerName(src) or ('ID ' .. tostring(src)),
        message = tostring(message or '')
    }), {
        ['Content-Type'] = 'application/json',
        ['x-api-key'] = API_KEY
    })
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

local function revivePlayer(target)
    local ok = pcall(function()
        exports['plt_ambulance_job']:RevivePlayer(tonumber(target))
    end)
    if ok then return true end

    ok = pcall(function()
        exports['plt_ambulance_job']:InternalRevive(tonumber(target))
    end)
    if ok then return true end

    TriggerClientEvent('unova:admin:reviveFallback', target)
    return false
end

local function makePlayerDead(target)
    pcall(function()
        exports['plt_ambulance_job']:manuallyKnockout(tonumber(target), true)
    end)

    TriggerClientEvent('unova:admin:makeDeadFallback', target)
    return true
end

local function findPlayerByDiscordId(discordId)
    if not discordId then return nil end
    for _, playerId in ipairs(GetPlayers()) do
        if getDiscordId(playerId) == tostring(discordId) then
            return playerId
        end
    end
    return nil
end

local function requestScreenshotFromResource(resourceName, target, cb)
    return pcall(function()
        exports[resourceName]:requestClientScreenshot(tonumber(target) or target, {
            encoding = 'jpg',
            quality = 0.18
        }, function(first, second)
            local errorMessage = nil
            local image = nil

            if second ~= nil then
                errorMessage = first
                image = second
            else
                image = first
            end

            if type(image) == 'string' and image ~= '' and not image:find('^data:') and not image:find('^https?://') then
                image = 'data:image/jpeg;base64,' .. image
            end

            cb(errorMessage, image)
        end)
    end)
end

local function captureSpectateFrame(request)
    local sessionId = tostring(request.sessionId or '')
    if sessionId == '' or spectateCaptureInFlight[sessionId] then
        return
    end
    spectateCaptureInFlight[sessionId] = true

    local target = request.playerId and GetPlayerName(tostring(request.playerId)) and tostring(request.playerId) or nil
    if not target then
        postSpectateFrame(sessionId, nil, 'Target player is not online.')
        return
    end

    local function done(errorMessage, image)
        if errorMessage then
            postSpectateFrame(sessionId, nil, tostring(errorMessage))
            return
        end
        postSpectateFrame(sessionId, image, nil)
    end

    local ok = requestScreenshotFromResource('screenshot', target, done)
    if ok then return end

    ok = requestScreenshotFromResource('screenshot-basic', target, done)
    if ok then return end

    postSpectateFrame(sessionId, nil, 'No screenshot resource export found.')
end

local function pollSpectateRequests()
    PerformHttpRequest(apiUrl('/fivem/spectate/requests'), function(status, body, _, errorData)
        if status ~= 200 or not body then
            if status ~= 200 then
                logHttpFailure('Spectate requests', status, body, errorData)
            end
            return
        end

        local data = json.decode(body)
        if not data or not data.requests then return end
        for _, request in ipairs(data.requests) do
            captureSpectateFrame(request)
        end
    end, 'GET', '', { ['x-api-key'] = API_KEY })
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
            elseif action.action == 'revive' and target then
                revivePlayer(target)
                notifyInEyes(target, 'Unova Medical', 'You have been revived by management.')
            elseif action.action == 'down' and target then
                makePlayerDead(target)
                notifyInEyes(target, 'Unova Medical', 'You have been marked down by management.')
            elseif action.action == 'spectate' and target then
                local moderator = findPlayerByDiscordId(action.moderatorDiscordId)
                if moderator then
                    TriggerClientEvent('unova:admin:startSpectate', moderator, {
                        targetServerId = tonumber(target),
                        targetName = action.playerName or GetPlayerName(target)
                    })
                else
                    print('[Unova Dashboard] Spectate requested but moderator is not in city: ' .. tostring(action.moderatorDiscordId))
                end
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
        print('[Unova Management] /unova can only be opened in-game.')
        return
    end

    checkAdminAccess(src, function(allowed)
        if not allowed then
            TriggerClientEvent('chat:addMessage', src, {
                args = {'Unova Management', 'Management only.'}
            })
            return
        end

        fetchTickets(function(tickets)
            TriggerClientEvent('unova:admin:openPanel', src, getPlayerList(), tickets)
        end)
    end)
end

RegisterCommand('unova', function(src)
    openAdminPanel(src)
end, false)

RegisterCommand('adminui', function(src)
    if src ~= 0 then
        TriggerClientEvent('chat:addMessage', src, {
            args = {'Unova Management', 'Use /unova. /adminui is now an alias.'}
        })
    end
    openAdminPanel(src)
end, false)

RegisterNetEvent('unova:admin:requestOpenPanel', function()
    openAdminPanel(source)
end)

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
            args = {'Unova Management', 'Use /unova. /founderui is now an alias.'}
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
        fetchTickets(function(tickets)
            TriggerClientEvent('unova:admin:updatePlayers', src, getPlayerList(), tickets)
        end)
    end)
end)

RegisterNetEvent('unova:ticket:open', function(data)
    local src = source
    if type(data) ~= 'table' then return end

    checkAdminAccess(src, function(allowed)
        if not allowed then return end

        fetchTicketMessages(src, tostring(data.channelId or ''), function(result, errorMessage)
            if errorMessage then
                notifyAdmin(src, errorMessage, false)
                return
            end

            TriggerClientEvent('unova:ticket:messages', src, result)
        end)
    end)
end)

RegisterNetEvent('unova:ticket:reply', function(data)
    local src = source
    if type(data) ~= 'table' then return end

    checkAdminAccess(src, function(allowed)
        if not allowed then return end

        sendTicketMessage(src, tostring(data.channelId or ''), tostring(data.message or ''), function(result, errorMessage)
            if errorMessage then
                notifyAdmin(src, errorMessage, false)
                return
            end

            fetchTicketMessages(src, tostring(data.channelId or ''), function(messagesResult, messagesError)
                if messagesError then
                    notifyAdmin(src, messagesError, false)
                    return
                end

                TriggerClientEvent('unova:ticket:messages', src, messagesResult)
            end)
        end)
    end)
end)

RegisterNetEvent('unova:admin:moderate', function(data)
    local src = source
    if type(data) ~= 'table' then return end

    checkAdminAccess(src, function(allowed)
        if not allowed then return end

        local action = tostring(data.action or '')
        if action ~= 'warn' and action ~= 'kick' and action ~= 'ban' and action ~= 'revive' and action ~= 'down' and action ~= 'spectate' then
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
        if reason == '' and action ~= 'revive' and action ~= 'down' and action ~= 'spectate' then
            notifyAdmin(src, 'Reason is required.', false)
            return
        end
        if reason == '' and action == 'revive' then
            reason = 'Revive requested'
        elseif reason == '' and action == 'down' then
            reason = 'Marked dead by management'
        elseif reason == '' and action == 'spectate' then
            reason = 'Spectate requested'
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
                if action == 'revive' then
                    notifyAdmin(src, 'revive submitted.', true)
                elseif action == 'down' then
                    notifyAdmin(src, 'make dead submitted.', true)
                elseif action == 'spectate' then
                    TriggerClientEvent('unova:admin:startSpectate', src, {
                        targetServerId = targetInfo.id,
                        targetName = targetInfo.name
                    })
                    notifyAdmin(src, 'spectate started.', true)
                else
                    notifyAdmin(src, action .. ' submitted. Discord ticket opened if the bot has channel permissions.', true)
                end
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
    deferrals.update('Unova Roleplay | Preparing your city queue...')

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
                local releaseAt = startedAt + 10

                while true do
                    local position = queuePosition(src)
                    local online = #GetPlayers()
                    local waited = os.time() - startedAt
                    local releaseIn = math.max(0, releaseAt - os.time())
                    local status = releaseIn > 0
                        and ('Security sync completing. Minimum city wait: ' .. tostring(releaseIn) .. 's.')
                        or 'Queue verified. Waiting for your city slot.'
                    presentQueueCard(deferrals, entry, position, online, maxPlayers, waited, status)

                    if position <= 1 and online < maxPlayers and os.time() >= releaseAt then
                        removeQueueEntry(src)
                        presentQueueCard(deferrals, entry, position, online, maxPlayers, waited, 'Queue cleared. Opening your route into Unova City...')
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

CreateThread(function()
    while true do
        pollSpectateRequests()
        Wait(SPECTATE_FRAME_INTERVAL_MS)
    end
end)
