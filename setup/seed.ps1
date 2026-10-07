<#
    seed.ps1

    Corre el seed MASIVO sobre el cluster MongoDB sharded del taller. Llena
    `taller_perfiles.usuarios` con 60 docs (15 por pais: AR/CO/ES/MX) y
    `taller_actividad.eventos` con ~600 docs (10 por usuario).

    Diferencia con setup-cluster.ps1:
        - setup-cluster.ps1 INICIALIZA el cluster (levanta contenedores,
          inicia replica sets, agrega shards, habilita sharding, inserta seed
          minimo de 4+4 docs). Es para arrancar de cero.
        - seed.ps1 SOLO corre el seed masivo (paso 6 del taller). Pensado para
          correr muchas veces sin reinicializar nada. El script BORRA todos
          los docs y los regenera desde pools deterministicos.

    Idempotente: borrar + insertar produce el mismo dataset en cada corrida.

    Requisitos:
        - Cluster ya corriendo (taller-bd-mongos healthy). Si no, corré
          antes: .\setup\setup-cluster.ps1

    Uso:
        PS> .\setup\seed.ps1
#>

[CmdletBinding()]
param()

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

# 1. Verificar que el cluster está corriendo.
Step "Verificando que el cluster esta corriendo..."
$mongosRunning = docker ps --filter "name=taller-bd-mongos" --filter "status=running" --format "{{.Names}}" 2>$null
if ([string]::IsNullOrWhiteSpace($mongosRunning) -or $mongosRunning -notmatch "taller-bd-mongos") {
    Fail "El contenedor 'taller-bd-mongos' no esta corriendo."
    Fail "Corre primero:  .\setup\setup-cluster.ps1"
    exit 1
}
Good "taller-bd-mongos esta corriendo"

# 2. Verificar que el contenedor responde por mongosh.
Step "Ping a mongos..."
$pingOut = docker exec taller-bd-mongos mongosh --port 27017 --quiet --eval "db.adminCommand({ping:1}).ok" 2>$null
if ($pingOut -notmatch "^\s*1\s*$") {
    Fail "mongos no responde a ping. Esperaba '1', recibi: $pingOut"
    exit 1
}
Good "mongos responde (ping=1)"

# 3. Correr el seed.
Step "Ejecutando seed masivo (setup/05-seed.js) dentro de mongos..."
$seedScript = Join-Path $PSScriptRoot "05-seed.js"
if (-not (Test-Path -LiteralPath $seedScript)) {
    Fail "No encuentro el script: $seedScript"
    exit 1
}

# Nota: el JS seed ya BORRA todos los docs antes de insertar, asi que es
# idempotente. Si lo corres dos veces seguidas, regenera el mismo dataset.
Get-Content -LiteralPath $seedScript -Raw | docker exec -i taller-bd-mongos mongosh --port 27017 --quiet
if ($LASTEXITCODE -ne 0) {
    Fail "Fallo 05-seed.js (exit=$LASTEXITCODE)"
    exit 1
}
Good "Seed masivo completado"

# 4. Resumen final con la distribucion que ve el cluster.
Step "Resumen final: distribucion por shard"

Write-Host ""
Write-Host "  --- taller_perfiles.usuarios ---" -ForegroundColor Green
$distroUserCmd = "db.getSiblingDB('taller_perfiles').usuarios.getShardDistribution()"
docker exec -i taller-bd-mongos mongosh --port 27017 --quiet --eval $distroUserCmd
if ($LASTEXITCODE -ne 0) {
    Warn "getShardDistribution() de usuarios fallo (exit=$LASTEXITCODE)"
}

Write-Host ""
Write-Host "  --- taller_actividad.eventos ---" -ForegroundColor Green
$distroEvtCmd = "db.getSiblingDB('taller_actividad').eventos.getShardDistribution()"
docker exec -i taller-bd-mongos mongosh --port 27017 --quiet --eval $distroEvtCmd
if ($LASTEXITCODE -ne 0) {
    Warn "getShardDistribution() de eventos fallo (exit=$LASTEXITCODE)"
}

Write-Host ""
Write-Host "  --- Conteos por pais (deberia ser 15/15/15/15) ---" -ForegroundColor Green
$porPaisCmd = @'
db.getSiblingDB('taller_perfiles').usuarios.aggregate([{$group: {_id: '$pais', total: {$sum: 1}}}, {$sort: {_id: 1}}]).toArray()
'@
docker exec -i taller-bd-mongos mongosh --port 27017 --quiet --eval $porPaisCmd

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  SEED MASIVO COMPLETADO" -ForegroundColor Green
Write-Host "" -ForegroundColor Green
Write-Host "  Verificacion manual:" -ForegroundColor Green
Write-Host '    docker exec -i taller-bd-mongos mongosh --port 27017 --eval "db.getSiblingDB(''taller_perfiles'').usuarios.find({pais:''AR''}).count()"' -ForegroundColor Green
Write-Host '    docker exec -i taller-bd-mongos mongosh --port 27017 --eval "db.getSiblingDB(''taller_perfiles'').usuarios.getShardDistribution()"' -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green