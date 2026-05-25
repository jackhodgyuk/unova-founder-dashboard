local panelOpen = false

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

RegisterNetEvent('unova:admin:eyesNotice', function(payload)
    local title = payload.title or 'Unova'
    local message = payload.message or ''
    SendNUIMessage({
        type = 'toast',
        title = title,
        message = message
    })
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
    local knocked = pcall(function()
        exports['plt_ambulance_job']:manuallyKnockout(true)
    end)
    if knocked then return end

    SetEntityHealth(PlayerPedId(), 0)
end)

RegisterCommand('unova_admin_keybind', function()
    TriggerServerEvent('unova:admin:requestOpenPanel')
end, false)

RegisterKeyMapping('unova_admin_keybind', 'Open Unova Admin Panel', 'keyboard', 'F2')

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

CreateThread(function()
    while true do
        if panelOpen and IsControlJustReleased(0, 322) then
            panelOpen = false
            SetNuiFocus(false, false)
            SendNUIMessage({ type = 'close' })
        end
        Wait(0)
    end
end)
