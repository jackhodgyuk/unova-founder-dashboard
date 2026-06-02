local panelOpen = false
local spectating = false
local spectateTarget = nil

local function showToast(title, message)
    SendNUIMessage({
        type = 'toast',
        title = title or 'Unova',
        message = message or ''
    })
end

local function stopSpectate()
    if not spectating then return end
    NetworkSetInSpectatorMode(false, PlayerPedId())
    SetFocusEntity(PlayerPedId())
    spectating = false
    spectateTarget = nil
    showToast('Unova Spectate', 'Spectate stopped.')
end

RegisterNetEvent('unova:admin:openPanel', function(players, tickets)
    panelOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        type = 'open',
        players = players or {},
        tickets = tickets or {}
    })
end)

RegisterNetEvent('unova:admin:openReport', function(players)
    panelOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        type = 'openReport',
        players = players or {}
    })
end)

RegisterNetEvent('unova:admin:updatePlayers', function(players, tickets)
    SendNUIMessage({
        type = 'players',
        players = players or {},
        tickets = tickets or {}
    })
end)

RegisterNetEvent('unova:admin:notice', function(payload)
    SendNUIMessage({
        type = 'notice',
        message = payload.message,
        ok = payload.ok
    })
end)

RegisterNetEvent('unova:ticket:messages', function(payload)
    SendNUIMessage({
        type = 'ticketMessages',
        ticket = payload and payload.ticket or nil,
        messages = payload and payload.messages or {},
        canSend = payload and payload.canSend == true
    })
end)

RegisterNetEvent('unova:admin:eyesNotice', function(payload)
    showToast(payload.title or 'Unova', payload.message or '')
end)

RegisterNetEvent('unova:admin:reviveFallback', function()
    local revived = pcall(function()
        exports['plt_ambulance_job']:RevivePlayer()
    end)
    if revived then return end

    local ped = PlayerPedId()
    local coords = GetEntityCoords(ped)
    NetworkResurrectLocalPlayer(coords.x, coords.y, coords.z, GetEntityHeading(ped), true, false)
    ClearPedBloodDamage(ped)
    ClearPedTasksImmediately(ped)
    SetEntityHealth(ped, GetEntityMaxHealth(ped))
end)

RegisterNetEvent('unova:admin:makeDeadFallback', function()
    pcall(function()
        exports['plt_ambulance_job']:manuallyKnockout(true)
    end)

    local ped = PlayerPedId()
    SetEntityHealth(ped, 0)
    ApplyDamageToPed(ped, 200, false)
    SetPedToRagdoll(ped, 6000, 6000, 0, false, false, false)
    CreateThread(function()
        for _ = 1, 20 do
            Wait(250)
            local currentPed = PlayerPedId()
            SetEntityHealth(currentPed, 0)
            ApplyDamageToPed(currentPed, 200, false)
        end
    end)
end)

RegisterNetEvent('unova:admin:startSpectate', function(payload)
    local targetServerId = tonumber(payload and payload.targetServerId)
    if not targetServerId then
        showToast('Unova Spectate', 'No target player was supplied.')
        return
    end

    local targetPlayer = GetPlayerFromServerId(targetServerId)
    if targetPlayer == -1 or not NetworkIsPlayerActive(targetPlayer) then
        showToast('Unova Spectate', 'Target is not streamed to your client yet. Move closer or try again.')
        return
    end

    local targetPed = GetPlayerPed(targetPlayer)
    if not targetPed or targetPed == 0 then
        showToast('Unova Spectate', 'Could not lock onto that player.')
        return
    end

    panelOpen = false
    SetNuiFocus(false, false)
    SendNUIMessage({ type = 'close' })

    spectating = true
    spectateTarget = targetServerId
    SetFocusEntity(targetPed)
    NetworkSetInSpectatorMode(true, targetPed)
    showToast('Unova Spectate', 'Spectating ' .. (payload.targetName or ('ID ' .. targetServerId)) .. '. Use /stopspectate to stop.')
end)

RegisterCommand('unova_admin_keybind', function()
    TriggerServerEvent('unova:admin:requestOpenPanel')
end, false)

RegisterKeyMapping('unova_admin_keybind', 'Open Unova Admin Panel', 'keyboard', 'F2')

RegisterCommand('stopspectate', function()
    stopSpectate()
end, false)

RegisterNUICallback('close', function(_, cb)
    panelOpen = false
    SetNuiFocus(false, false)
    SendNUIMessage({ type = 'close' })
    cb({ ok = true })
end)

RegisterNUICallback('refresh', function(_, cb)
    TriggerServerEvent('unova:admin:refreshPlayers')
    cb({ ok = true })
end)

RegisterNUICallback('moderate', function(data, cb)
    TriggerServerEvent('unova:admin:moderate', data)
    cb({ ok = true })
end)

RegisterNUICallback('report', function(data, cb)
    TriggerServerEvent('unova:report:submit', data)
    cb({ ok = true })
end)

RegisterNUICallback('openTicket', function(data, cb)
    TriggerServerEvent('unova:ticket:open', data)
    cb({ ok = true })
end)

RegisterNUICallback('replyTicket', function(data, cb)
    TriggerServerEvent('unova:ticket:reply', data)
    cb({ ok = true })
end)

CreateThread(function()
    while true do
        if spectating then
            local targetPlayer = GetPlayerFromServerId(spectateTarget)
            if targetPlayer == -1 or not NetworkIsPlayerActive(targetPlayer) then
                stopSpectate()
            elseif IsControlJustReleased(0, 177) then
                stopSpectate()
            else
                local targetPed = GetPlayerPed(targetPlayer)
                if targetPed and targetPed ~= 0 then
                    NetworkSetInSpectatorMode(true, targetPed)
                    SetFocusEntity(targetPed)
                end
            end
        end

        if panelOpen and IsControlJustReleased(0, 322) then
            panelOpen = false
            SetNuiFocus(false, false)
            SendNUIMessage({ type = 'close' })
        end
        Wait(0)
    end
end)
