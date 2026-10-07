# Smoke test end-to-end del taller.
# Asume que el cluster MongoDB esta corriendo y que el backend esta en :3001.
# Sale con exit code != 0 si alguna validacion falla.

$ErrorActionPreference = 'Stop'
$backend = 'http://localhost:3001'

function Check($desc, $expected, $actual) {
  $ok = ($expected -eq $actual) -or ($expected -is [scriptblock] -and (& $expected $actual))
  $icon = if ($ok) { '[OK]  ' } else { '[FAIL]' }
  Write-Host "$icon $desc"
  if (-not $ok) {
    Write-Host "       esperado: $expected"
    Write-Host "       actual:   $actual"
    $script:fails++
  }
}

function Get-Json($path) {
  (Invoke-WebRequest "$backend$path" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
}

$fails = 0

Write-Host '=== /health ===' -ForegroundColor Cyan
$h = Get-Json '/health'
Check 'health.ok' $true $h.ok
Check 'health.version 7.0.x' { $args[0].version -like '7.0.*' } $h
Check 'health.shards=2' 2 $h.shards

Write-Host '=== CRUD usuarios ===' -ForegroundColor Cyan
$body = @{ nombre='Smoke Test'; email="smoke.$(Get-Date -Format 'HHmmss')@taller.dev"; pais='AR' } | ConvertTo-Json
$r = Invoke-WebRequest "$backend/api/usuarios" -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 5
$creado = $r.Content | ConvertFrom-Json
Check 'crear.ok' $true $creado.ok
Check 'crear.shard_destino=shard01-rs' 'shard01-rs' $creado.meta.shard_destino
Check 'crear.operacion=targeted' 'targeted' $creado.meta.operacion

$get = Get-Json "/api/usuarios?pais=AR&limit=3"
Check 'listar.ok' $true $get.ok
Check 'listar.operacion=targeted' 'targeted' $get.meta.operacion
Check 'listar.shard_destino=shard01-rs' 'shard01-rs' $get.meta.shard_destino

$get2 = Get-Json "/api/usuarios?pais=MX&limit=3"
Check 'listar MX targeted a shard02-rs' 'shard02-rs' $get2.meta.shard_destino

$get3 = Get-Json "/api/usuarios?limit=3"
Check 'listar sin filtro = scatter-gather' 'shard01-rs + shard02-rs' $get3.meta.shard_destino

$uno = Get-Json "/api/usuarios/usr-AR-001"
Check 'get-one.ok' $true $uno.ok
Check 'get-one shard derivado de pais AR' 'shard01-rs' $uno.meta.shard_destino

Write-Host '=== CRUD eventos ===' -ForegroundColor Cyan
$body2 = @{ tipo='purchase'; payload=@{ producto_id='smoke'; monto=1.99 } } | ConvertTo-Json
$r2 = Invoke-WebRequest "$backend/api/usuarios/usr-AR-001/eventos" -Method POST -ContentType 'application/json' -Body $body2 -UseBasicParsing -TimeoutSec 5
$ev = $r2.Content | ConvertFrom-Json
Check 'crear evento.ok' $true $ev.ok
Check 'crear evento.operacion=targeted' 'targeted' $ev.meta.operacion

$evs = Get-Json "/api/usuarios/usr-AR-001/eventos?limit=3"
Check 'listar eventos del usuario count>=1' { $args[0].count -ge 1 } $evs

Write-Host '=== Admin ===' -ForegroundColor Cyan
$ss = Get-Json '/api/admin/shard-status'
Check 'shard-status ok' $true $ss.ok
Check 'shard-status 2 shards' 2 ($ss.shards.Count)

$dist = Get-Json '/api/admin/distribucion'
Check 'distribucion.usuarios.por_pais 4 paises' 4 ($dist.usuarios.por_pais.Count)
Check 'distribucion.eventos.por_tipo 8 tipos' 8 ($dist.eventos.por_tipo.Count)

$bal = Get-Json '/api/admin/balance'
Check 'balance.usuarios >= 60' { $args[0].totales.usuarios -ge 60 } $bal
Check 'balance.eventos >= 600' { $args[0].totales.eventos -ge 600 } $bal
Check 'balance.bases_de_datos=2' 2 $bal.totales.bases_de_datos

$de = Get-Json '/api/admin/donde-esta/usr-AR-001'
Check 'donde-esta.perfil.existe' $true $de.perfil.existe
Check 'donde-esta.perfil.shard=shard01-rs' 'shard01-rs' $de.perfil.shard_destino
Check 'donde-esta.eventos.count>=10' { $args[0].total -ge 10 } $de.eventos

Write-Host ''
Write-Host ("=== RESUMEN: {0} falla(s) ===" -f $fails) -ForegroundColor $(if ($fails -eq 0) { 'Green' } else { 'Red' })
exit $fails