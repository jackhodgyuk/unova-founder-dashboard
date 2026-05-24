local DASHBOARD_URL = GetConvar('unova_dashboard_url', 'http://127.0.0.1:3001')
local API_KEY = GetConvar('unova_dashboard_key', 'change_this_fivem_secret')
local FOUNDER_DISCORD_ID = GetConvar('unova_founder_discord_id', '681156025365299220')

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

local function isFounder(src)
    if src == 0 then return true end
    if IsPlayerAceAllowed(src, 'unova.founder') then return true end
    return getDiscordId(src) == FOUNDER_DISCORD_ID
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

local function notifyFounder(src, message, ok)
    TriggerClientEvent('unova:founder:notice', src, {
        message = message,
        ok = ok == true
    })
    TriggerClientEvent('chat:addMessage', src, {
        args = {'Unova Founder', message}
    })
end

local function sendStatus()
    local players = getPlayerList()

    PerformHttpRequest(DASHBOARD_URL .. '/fivem/update', function(status)
        if status ~= 200 then
            print('[Unova Dashboard] Status update failed: ' .. tostring(status))
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
    PerformHttpRequest(DASHBOARD_URL .. '/fivem/moderation/poll', function(status, body)
        if status ~= 200 or not body then return end
        local data = json.decode(body)
        if not data or not data.actions then return end

        for _, action in ipairs(data.actions) do
            local reason = action.reason or 'No reason provided'
            local target = findPlayerForAction(action)

            if action.action == 'warn' and target then
                TriggerClientEvent('chat:addMessage', target, {
                    args = {'Unova Staff Warning', reason}
                })
            elseif action.action == 'kick' and target then
                DropPlayer(target, 'Kicked from Unova: ' .. reason)
            elseif action.action == 'ban' and target then
                DropPlayer(target, 'Banned from Unova: ' .. reason)
            end
        end
    end, 'GET', '', { ['x-api-key'] = API_KEY })
end

RegisterCommand('founderui', function(src)
    if src == 0 then
        print('[Unova Founder] /founderui can only be opened in-game.')
        return
    end

    if not isFounder(src) then
        TriggerClientEvent('chat:addMessage', src, {
            args = {'Unova Founder', 'Founder only.'}
        })
        return
    end

    TriggerClientEvent('unova:founder:openPanel', src, getPlayerList())
end, false)

RegisterNetEvent('unova:founder:refreshPlayers', function()
    local src = source
    if not isFounder(src) then return end
    TriggerClientEvent('unova:founder:updatePlayers', src, getPlayerList())
end)

RegisterNetEvent('unova:founder:moderate', function(data)
    local src = source
    if not isFounder(src) then return end
    if type(data) ~= 'table' then return end

    local action = tostring(data.action or '')
    if action ~= 'warn' and action ~= 'kick' and action ~= 'ban' then
        notifyFounder(src, 'Invalid moderation action.', false)
        return
    end

    local targetId = tonumber(data.playerId)
    local targetInfo = targetId and getPlayerInfo(targetId) or nil
    if not targetInfo then
        notifyFounder(src, 'That player is no longer online.', false)
        return
    end

    local reason = tostring(data.reason or '')
    if reason == '' then
        notifyFounder(src, 'Reason is required.', false)
        return
    end

    local payload = {
        playerId = targetInfo.id,
        playerName = targetInfo.name,
        discordId = targetInfo.discordId,
        license = targetInfo.license,
        reason = reason,
        moderatorDiscordId = getDiscordId(src) or FOUNDER_DISCORD_ID
    }

    PerformHttpRequest(DASHBOARD_URL .. '/fivem/founder/moderation/' .. action, function(status, body)
        if status == 200 then
            notifyFounder(src, action .. ' submitted. Discord ticket opened if the bot has channel permissions.', true)
            TriggerClientEvent('unova:founder:updatePlayers', src, getPlayerList())
            return
        end

        notifyFounder(src, 'Moderation request failed: ' .. tostring(status) .. ' ' .. tostring(body or ''), false)
    end, 'POST', json.encode(payload), {
        ['Content-Type'] = 'application/json',
        ['x-api-key'] = API_KEY
    })
end)

AddEventHandler('playerConnecting', function(name, setKickReason, deferrals)
    local src = source
    local license = getLicense(src)
    if not license then return end

    deferrals.defer()
    Wait(0)
    deferrals.update('Checking Unova ban status...')

    PerformHttpRequest(DASHBOARD_URL .. '/fivem/bans/check?license=' .. license, function(status, body)
        if status == 200 and body then
            local data = json.decode(body)
            if data and data.banned then
                deferrals.done('You are banned from Unova: ' .. (data.ban.reason or 'No reason provided'))
                return
            end
        end
        deferrals.done()
    end, 'GET', '', { ['x-api-key'] = API_KEY })
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
