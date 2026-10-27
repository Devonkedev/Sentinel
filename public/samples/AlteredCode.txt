#include <algorithm>
#include <iostream>

class World {
public:
    World(int width, int height)
        : width_(width), height_(height) {}

    void render(const Character& character) const {
        for (int y = 0; y < height_; ++y) {
            for (int x = 0; x < width_; ++x) {
                std::cout << (
                    x == character.x() && y == character.y()
                        ? '@'
                        : '.'
                );
            }
            std::cout << '\n';
        }
    }

    int width() const { return width_; }
    int height() const { return height_; }

private:
    int width_;
    int height_;
};

class Game {
public:
    Game()
        : world_(24, 12), character_(12, 6) {}

    void run() {
        char input = 0;

        while (input != 'q') {
            world_.render(character_);

            if (!(std::cin >> input)) {
                break;
            }

            switch (input) {
                case 'w':
                    character_.move(
                        0, -1, world_.width(), world_.height()
                    );
                    break;
                case 's':
                    character_.move(
                        0, 1, world_.width(), world_.height()
                    );
                    break;
                case 'a':
                    character_.move(
                        -1, 0, world_.width(), world_.height()
                    );
                    break;
                case 'd':
                    character_.move(
                        1, 0, world_.width(), world_.height()
                    );
                    break;
                default:
                    break;
            }
        }
    }

private:
    World world_;
    Character character_;
};

int main() {
    Game game;
    game.run();
    return 0;
}
