#!/usr/bin/env bash
# elog_service_setup.sh
#
# Run this script from your service's working directory to print all the
# information needed to register it in elog (Experiment tab → + New Service).
#
# Usage:
#   cd /path/to/your/service
#   /path/to/elog_service_setup.sh

SERVICE_NAME="$(basename "$(pwd)")"
HOST_NAME="$(hostname)"
DIRECTORY="$(pwd)"
PORT=8080

echo ""
echo "=== elog Service Registration Info ==="
echo ""
printf "%-16s %s\n" "Name:"        "${SERVICE_NAME}"
printf "%-16s %s\n" "Description:" "(empty — fill in manually)"
printf "%-16s %s\n" "Host name:"   "${HOST_NAME}"
printf "%-16s %s\n" "Directory:"   "${DIRECTORY}"
printf "%-16s %s\n" "Request URL:" "http://${HOST_NAME}:${PORT}/your-webhook-endpoint"
echo ""
echo "Copy the above info into elog → Experiment → + New Service"
echo "For Systems: use an API token instead of Request URL."
echo ""
