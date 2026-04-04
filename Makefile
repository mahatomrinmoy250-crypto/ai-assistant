.PHONY: dev prod logs down migrate

## dev — start all services with hot-reload volumes (development mode)
dev:
	docker compose -f docker-compose.yml up

## prod — build images and start all services in detached production mode
prod:
	docker compose -f docker-compose.yml up -d --build

## logs — tail logs from all running services
logs:
	docker compose -f docker-compose.yml logs -f

## down — stop and remove containers (volumes are preserved)
down:
	docker compose -f docker-compose.yml down

## migrate — run pending Prisma migrations inside the backend container
migrate:
	docker compose -f docker-compose.yml exec backend npx prisma migrate deploy
