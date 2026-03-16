// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {PaimaL2Contract} from "@paimaexample/evm-contracts/src/contracts/PaimaL2Contract.sol";

contract MyPaimaL2Contract is PaimaL2Contract {
    /// @dev Game states for lobby management
    enum GameState { Open, Closed }

    /// @dev Player structure storing EVM address and Ed25519 public key
    struct Player {
        address evmAddress;
        bytes32 publicKey;
        uint8 appearanceCode;
    }

    /// @dev Game structure for lobby management
    struct Game {
        uint256 id;
        GameState state;
        Player[] players;
        uint256 playerCount;
        uint256 maxPlayers;
        // 64-byte encrypted game seed: 32-byte salt || HKDF(WEREWOLF_KEY_SECRET, salt) XOR seed.
        // Any node holding WEREWOLF_KEY_SECRET can decrypt the 32-byte game seed on-chain.
        bytes encryptedGameSeed;
    }

    /// @dev Mapping of games indexed by game ID
    mapping(uint256 => Game) public games;

    /// @dev Emitted when a new game is created
    /// encryptedGameSeed is a 64-byte blob (32-byte salt + 32-byte ciphertext) that
    /// any authorized node can decrypt using WEREWOLF_KEY_SECRET via HKDF-SHA-256.
    event GameCreated(uint32 indexed gameId, uint256 maxPlayers, bytes encryptedGameSeed);

    /// @dev Emitted when a player joins a game
    event PlayerJoined(uint256 indexed gameId, address indexed evmAddress, bytes32 publicKey, uint8 appearanceCode);

    /// @dev Emitted when a game is closed
    event GameClosed(uint256 indexed gameId);

    /// @dev Emitted when a game is force-started before full capacity or timeout
    event GameForceStarted(uint256 indexed gameId, uint256 playerCount);

    /// @dev Minimum players required to force-start a game
    uint256 public constant MIN_PLAYERS_TO_START = 5;

    constructor(address _owner, uint256 _fee) PaimaL2Contract(_owner, _fee) {}

    /// @dev Creates a new game lobby
    /// @param _gameId ID of the game to create
    /// @param _maxPlayers Maximum number of players for this game (max 16)
    /// @param _encryptedGameSeed 64-byte encrypted game seed (32-byte salt + 32-byte ciphertext).
    ///        Decryptable by any node holding WEREWOLF_KEY_SECRET via HKDF-SHA-256.
    function createGame(uint32 _gameId, uint256 _maxPlayers, bytes calldata _encryptedGameSeed) public {
        require(games[_gameId].id == 0, "Game already exists");
        require(_maxPlayers > 0 && _maxPlayers <= 16, "Invalid max players");
        require(_encryptedGameSeed.length == 64, "encryptedGameSeed must be 64 bytes");

        // Initialize storage fields individually to avoid memory[] -> storage copy.
        Game storage game = games[_gameId];
        game.id = _gameId;
        game.state = GameState.Open;
        game.playerCount = 0;
        game.maxPlayers = _maxPlayers;
        game.encryptedGameSeed = _encryptedGameSeed;

        emit GameCreated(_gameId, _maxPlayers, _encryptedGameSeed);
    }

    /// @dev Joins an existing game lobby
    /// @param _gameId ID of the game to join
    /// @param _publicKey Ed25519 public key for bundle retrieval authentication
    /// @param _appearanceCode Packed avatar appearance (0-255)
    function joinGame(uint256 _gameId, bytes32 _publicKey, uint8 _appearanceCode) public {
        require(games[_gameId].id != 0, "Game not found");
        require(games[_gameId].state == GameState.Open, "Game is closed");
        require(games[_gameId].playerCount < games[_gameId].maxPlayers, "Game is full");

        // Check if player already joined
        for (uint256 i = 0; i < games[_gameId].playerCount; i++) {
            require(games[_gameId].players[i].evmAddress != msg.sender, "Player already joined");
        }

        // Add player
        games[_gameId].players.push(Player({
            evmAddress: msg.sender,
            publicKey: _publicKey,
            appearanceCode: _appearanceCode
        }));
        games[_gameId].playerCount++;

        emit PlayerJoined(_gameId, msg.sender, _publicKey, _appearanceCode);
    }

    /// @dev Closes a game lobby, preventing new players from joining
    /// @param _gameId ID of the game to close
    function closeGame(uint256 _gameId) public {
        require(games[_gameId].id != 0, "Game not found");
        require(games[_gameId].state == GameState.Open, "Game already closed");
        
        games[_gameId].state = GameState.Closed;
        
        emit GameClosed(_gameId);
    }

    /// @dev Force-starts a game early, before it fills or times out.
    ///      Requires at least MIN_PLAYERS_TO_START players to have joined.
    /// @param _gameId ID of the game to force-start
    function forceStart(uint256 _gameId) external {
        require(games[_gameId].id != 0, "Game not found");
        require(games[_gameId].state == GameState.Open, "Game is not open");
        require(
            games[_gameId].playerCount >= MIN_PLAYERS_TO_START,
            "Not enough players to force start"
        );

        games[_gameId].state = GameState.Closed;

        emit GameClosed(_gameId);
        emit GameForceStarted(_gameId, games[_gameId].playerCount);
    }

    /// @dev Returns game state and player count
    /// @param _gameId ID of the game to query
    function getGame(uint256 _gameId) public view returns (
        uint256 id,
        GameState state,
        uint256 playerCount,
        uint256 maxPlayers,
        bytes memory encryptedGameSeed
    ) {
        require(games[_gameId].id != 0, "Game not found");
        Game storage game = games[_gameId];
        return (game.id, game.state, game.playerCount, game.maxPlayers, game.encryptedGameSeed);
    }

    /// @dev Returns number of players in a game
    /// @param _gameId ID of the game to query
    function getPlayerCount(uint256 _gameId) public view returns (uint256) {
        require(games[_gameId].id != 0, "Game not found");
        return games[_gameId].playerCount;
    }

    /// @dev Returns whether a game is accepting players
    /// @param _gameId ID of the game to query
    function isGameOpen(uint256 _gameId) public view returns (bool) {
        require(games[_gameId].id != 0, "Game not found");
        return games[_gameId].state == GameState.Open;
    }

    /// @dev Returns all players in a game
    /// @param _gameId ID of the game to query
    function getPlayers(uint256 _gameId) public view returns (Player[] memory) {
        require(games[_gameId].id != 0, "Game not found");
        return games[_gameId].players;
    }

    /// @dev Returns a specific player in a game
    /// @param _gameId ID of the game to query
    /// @param _playerIndex Index of the player to retrieve
    function getPlayer(uint256 _gameId, uint256 _playerIndex) public view returns (
        address evmAddress,
        bytes32 publicKey,
        uint8 appearanceCode
    ) {
        require(games[_gameId].id != 0, "Game not found");
        require(_playerIndex < games[_gameId].playerCount, "Player index out of bounds");
        Player storage player = games[_gameId].players[_playerIndex];
        return (player.evmAddress, player.publicKey, player.appearanceCode);
    }

    /// @dev Checks if an address has already joined a game
    /// @param _gameId ID of the game to query
    /// @param _player EVM address to check
    function hasPlayerJoined(uint256 _gameId, address _player) public view returns (bool) {
        require(games[_gameId].id != 0, "Game not found");
        for (uint256 i = 0; i < games[_gameId].playerCount; i++) {
            if (games[_gameId].players[i].evmAddress == _player) {
                return true;
            }
        }
        return false;
    }
}
