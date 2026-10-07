<#
    setup-cluster.ps1

    Orquestador del setup del cluster MongoDB sharded para el taller.
    Idempotente: si lo corrés dos veces, no rompe (los scripts JS detectan el
    estado actual y skip lo que ya está hecho).

    Requisitos:
        - Docker Desktop abierto (docker info debe responder).
        - El docker-compose.yml debe estar en el directorio RAÍZ del repo
          (un nivel arriba de este script).

    Uso:
        PS> .\setup\setup-cluster.ps1

    Output esperado al final:
        sh.status() con 2 shards (shard01-rs, shard02-rs).
#>

[CmdletBinding()]
param(
    [int]$HealthWaitSeconds = 180,
    [int]$PrimaryWaitSeconds = 90,
    [int]$SettleSeconds = 10
)

$ErrorActionPreference = "Continue"

function Step([string]$msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Good([string]$msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Warn([string]$msg) {
    Write-Host "  [!!] $msg" -ForegroundColor Yellow
}

function Fail([string]$msg) {
    Write-Host "  [ERR] $msg" -ForegroundColor Red
}

# 1. Docker presente?
Step "Verificando Docker..."
try {
    docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw "docker info devolvio $LASTEXITCODE" }
    Good "Docker responde"
} catch {
    Fail "Docker no esta disponible o Docker Desktop no esta abierto."
    Fail "Abrilo y volve a correr este script."
    exit 1
}

# 2. Detectar docker compose (v2 primero, v1 como fallback)
Step "Detectando docker compose..."
$ComposeExe = $null
$ComposePrefix = @()

try {
    docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        $ComposeExe = "docker"
        $ComposePrefix = @("compose")
        Good "docker compose v2 disponible"
    }
} catch { }

if (-not $ComposeExe) {
    try {
        docker-compose version *> $null
        if ($LASTEXITCODE -eq 0) {
            $ComposeExe = "docker-compose"
            $ComposePrefix = @()
            Warn "docker-compose v1 (legacy). Recomendamos actualizar a Docker Desktop moderno."
        }
    } catch { }
}

if (-not $ComposeExe) {
    Fail "Ni 'docker compose' (v2) ni 'docker-compose' (v1) estan disponibles."
    exit 1
}

# 3. Levantar contenedores
Step "Levantando contenedores ($ComposeExe $($ComposePrefix -join ' ') up -d)..."
& $ComposeExe @ComposePrefix up -d
if ($LASTEXITCODE -ne 0) {
    Fail "Falló docker compose up -d"
    exit 1
}
Good "Contenedores iniciados"

# 4. Esperar healthchecks de los 4 contenedores
Step "Esperando healthchecks (max $HealthWaitSeconds s)..."
$services = @(
    @{ Name = "config01"; Container = "taller-bd-config01" },
    @{ Name = "shard01a"; Container = "taller-bd-shard01a" },
    @{ Name = "shard02a"; Container = "taller-bd-shard02a" },
    @{ Name = "mongos";   Container = "taller-bd-mongos"   }
)

$allHealthy = $false
$deadline = (Get-Date).AddSeconds($HealthWaitSeconds)
while ((Get-Date) -lt $deadline) {
    $statuses = @()
    $allHealthy = $true
    foreach ($svc in $services) {
        $status = docker inspect --format='{{.State.Health.Status}}' $svc.Container 2>$null
        if ([string]::IsNullOrWhiteSpace($status)) { $status = "(no-health)" }
        $statuses += ("{0}={1}" -f $svc.Name, $status)
        if ($status -ne "healthy") { $allHealthy = $false }
    }
    Write-Host ("    [health] " + ($statuses -join " | "))
    if ($allHealthy) { break }
    Start-Sleep -Seconds 3
}

if (-not $allHealthy) {
    Fail "No todos los servicios quedaron healthy a tiempo."
    Write-Host "Revisa el estado con: $ComposeExe $($ComposePrefix -join ' ') ps"
    Write-Host "Y los logs con: docker logs <container>"
    exit 1
}
Good "Los 4 servicios estan healthy"

# 5. Estabilizar nodos antes de initiate
Step "Esperando ${SettleSeconds}s adicionales para que los nodos estabilicen..."
Start-Sleep -Seconds $SettleSeconds
Good "Listos para initiate"

# 6. Inicializar los 3 replica sets
Step "Inicializando replica sets (config-rs + shard01-rs + shard02-rs)..."
$initScript = Join-Path $PSScriptRoot "01-init-replicasets.js"
if (-not (Test-Path -LiteralPath $initScript)) {
    Fail "No encuentro el script: $initScript"
    exit 1
}

Get-Content -LiteralPath $initScript -Raw | docker exec -i taller-bd-config01 mongosh --port 27017 --quiet
if ($LASTEXITCODE -ne 0) {
    Fail "Falló la inicializacion de replica sets (exit=$LASTEXITCODE)"
    exit 1
}
Good "Replica sets dispararon initiate"

# 8. Esperar a que cada RS tenga primary (myState=1)
Step "Esperando eleccion de primary en cada RS..."
$rsList = @(
    @{ Name = "config-rs";  Container = "taller-bd-config01"  },
    @{ Name = "shard01-rs"; Container = "taller-bd-shard01a" },
    @{ Name = "shard02-rs"; Container = "taller-bd-shard02a" }
)

foreach ($rs in $rsList) {
    $rsDeadline = (Get-Date).AddSeconds($PrimaryWaitSeconds)
    $got = $false
    while ((Get-Date) -lt $rsDeadline) {
        $out = docker exec $rs.Container mongosh --port 27017 --quiet --eval "try { print(rs.status().myState) } catch(e) { print(-1) }" 2>$null
        if ($out -match "^\s*1\s*$") {
            Good ("{0}: myState=1 (primary)" -f $rs.Name)
            $got = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $got) {
        Fail ("{0}: no llego a primary en {1}s" -f $rs.Name, $PrimaryWaitSeconds)
        Write-Host "Revisa logs: docker logs $($rs.Container)"
        exit 1
    }
}

# 9. Agregar los 2 shards al cluster via mongos
Step "Agregando shards al cluster (via mongos)..."
$addScript = Join-Path $PSScriptRoot "02-add-shards.js"
if (-not (Test-Path -LiteralPath $addScript)) {
    Fail "No encuentro el script: $addScript"
    exit 1
}

Get-Content -LiteralPath $addScript -Raw | docker exec -i taller-bd-mongos mongosh --port 27017 --quiet
if ($LASTEXITCODE -ne 0) {
    Fail "Fallo sh.addShard() (exit=$LASTEXITCODE)"
    exit 1
}
Good "Shards agregados al cluster"

# 10. Banner primero, después sh.status() (mongosh tiene stdout buffered; el banner
# escrito con Write-Host sale antes y se ve claro que el cluster ya está operativo).
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  CLUSTER LISTO" -ForegroundColor Green
Write-Host "  Conectate con:  mongosh --host localhost:27017" -ForegroundColor Green
Write-Host "  Ver shards:     mongosh --host localhost:27017 --eval 'sh.status()'" -ForegroundColor Green
Write-Host "  Apagar:         $ComposeExe $($ComposePrefix -join ' ') down" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green

Step "Estado final (sh.status desde mongos):"
docker exec taller-bd-mongos mongosh --port 27017 --quiet --eval "sh.status()"
if ($LASTEXITCODE -ne 0) {
    Warn "sh.status() fallo, pero los shards pueden estar agregados. Revisa el output."
}