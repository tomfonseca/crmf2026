.PHONY: dev stop test integration gen lint fmt agent build check security
dev stop test integration gen lint fmt agent build check security:
	python scripts/tasks.py $@
