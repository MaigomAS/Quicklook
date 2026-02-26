.PHONY: simulator backend monitor live record replay hardware-adapter

simulator:
	gcc -O2 -std=c11 -Wall -Wextra -o simulator/simulator simulator/src/main.c simulator/src/jsmn.c

backend:
	uvicorn backend.src.main:app --host 0.0.0.0 --port 8000

monitor:
	python tools/monitor/quicklook_tui.py

live:
	tools/scripts/run_live.sh

record:
	tools/scripts/run_record.sh

replay:
	tools/scripts/run_replay.sh


hardware-adapter:
	python3 hardware_adapter/adapter.py --help
