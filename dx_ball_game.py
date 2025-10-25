import time

WIDTH = 40
HEIGHT = 20

# Initialize bricks across the top
bricks = set()
for y in range(3):
    for x in range(WIDTH):
        bricks.add((x, y))

paddle_width = 7
paddle_x = WIDTH // 2 - paddle_width // 2

ball_x = WIDTH // 2
ball_y = HEIGHT // 2
vx = 1
vy = 1


def draw(frame):
    print(f"Frame {frame}")
    grid = [[' ' for _ in range(WIDTH)] for _ in range(HEIGHT)]
    for x, y in bricks:
        grid[y][x] = '#'
    for i in range(paddle_width):
        px = paddle_x + i
        if 0 <= px < WIDTH:
            grid[HEIGHT - 1][px] = '='
    if 0 <= ball_x < WIDTH and 0 <= ball_y < HEIGHT:
        grid[ball_y][ball_x] = 'O'
    for row in grid:
        print(''.join(row))
    print()


frame = 0
while True:
    draw(frame)
    frame += 1
    time.sleep(0.05)

    # Simple AI to move paddle
    if ball_x < paddle_x:
        paddle_x -= 1
    elif ball_x > paddle_x + paddle_width - 1:
        paddle_x += 1

    # Move ball
    ball_x += vx
    ball_y += vy

    # Wall collisions
    if ball_x <= 0 or ball_x >= WIDTH - 1:
        vx *= -1
        ball_x += vx
    if ball_y <= 0:
        vy *= -1
        ball_y += vy

    # Paddle collision
    if ball_y == HEIGHT - 2 and paddle_x <= ball_x < paddle_x + paddle_width:
        vy *= -1
        ball_y += vy

    # Brick collision
    if (ball_x, ball_y) in bricks:
        bricks.remove((ball_x, ball_y))
        vy *= -1
        ball_y += vy

    # Lose condition
    if ball_y >= HEIGHT:
        draw(frame)
        print("Game Over")
        break

    # Win condition
    if not bricks:
        draw(frame)
        print("You Win!")
        break
