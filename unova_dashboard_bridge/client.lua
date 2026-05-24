local panelOpen = false

RegisterNetEvent('unova:admin:openPanel', function(players)
    panelOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        type = 'open',
        players = players or {}
    })
end)

RegisterNetEvent('unova:admin:updatePlayers', function(players)
    SendNUIMessage({
        type = 'players',
        players = players or {}
    })
end)

RegisterNetEvent('unova:admin:notice', function(payload)
    SendNUIMessage({
        type = 'notice',
        message = payload.message,
        ok = payload.ok
    })
end)

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
