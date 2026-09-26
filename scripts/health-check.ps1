$ErrorActionPreference = 'Stop'
Invoke-RestMethod http://localhost:4000/health | ConvertTo-Json
