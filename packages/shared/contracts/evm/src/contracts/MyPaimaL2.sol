// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {PaimaL2Contract} from "@paimaexample/evm-contracts/src/contracts/PaimaL2Contract.sol";

contract MyPaimaL2Contract is PaimaL2Contract {
    /// @dev Game states for lobby management
    enum GameState { Open, Closed }

    /// @dev Player structure storing both EVM and Midnight addresses
    struct Player {
        address evmAddress;
        bytes32 midnightAddressHash;
    }

    /// @dev Game structure for lobby management
    struct Game {
        uint256 id;
        GameState state;
        Player[] players;
        uint256 playerCount;
        uint256 maxPlayers;
    }

    /// @dev Mapping of games indexed by game ID
    mapping(uint256 => Game) public games;

    /// @dev Counter for generating unique game IDs
    uint256 public nextGameId;

    /// @dev Emitted when a new game is created
    event GameCreated(uint256 indexed gameId, uint256 maxPlayers);

    /// @dev Emitted when a player joins a game
    event PlayerJoined(uint256 indexed gameId, address indexed evmAddress, bytes32 midnightAddressHash);

    /// @dev Emitted when a game is closed
    event GameClosed(uint256 indexed gameId);

    constructor(address _owner, uint256 _fee) PaimaL2Contract(_owner, _fee) {
        nextGameId = 1;
    }

    /// @dev Creates a new game lobby
    /// @param _maxPlayers Maximum number of players for this game (max 16)
    function createGame(uint256 _maxPlayers) public {
        require(_maxPlayers > 0 && _maxPlayers <= 16, "Invalid max players");
        
        uint256 gameId = nextGameId;
        nextGameId++;

        // Initialize storage fields individually to avoid memory[] -> storage copy.
        Game storage game = games[gameId];
        game.id = gameId;
        game.state = GameState.Open;
        game.playerCount = 0;
        game.maxPlayers = _maxPlayers;
        
        emit GameCreated(gameId, _maxPlayers);
    }

    /// @dev Joins an existing game lobby
    /// @param _gameId ID of the game to join
    /// @param _midnightAddressHash SHA256 hash of the player's Midnight unshielded address
    function joinGame(uint256 _gameId, bytes32 _midnightAddressHash) public {
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
            midnightAddressHash: _midnightAddressHash
        }));
        games[_gameId].playerCount++;
        
        emit PlayerJoined(_gameId, msg.sender, _midnightAddressHash);
    }

    /// @dev Closes a game lobby, preventing new players from joining
    /// @param _gameId ID of the game to close
    function closeGame(uint256 _gameId) public {
        require(games[_gameId].id != 0, "Game not found");
        require(games[_gameId].state == GameState.Open, "Game already closed");
        
        games[_gameId].state = GameState.Closed;
        
        emit GameClosed(_gameId);
    }

    /// @dev Returns game state and player count
    /// @param _gameId ID of the game to query
    function getGame(uint256 _gameId) public view returns (
        uint256 id,
        GameState state,
        uint256 playerCount,
        uint256 maxPlayers
    ) {
        require(games[_gameId].id != 0, "Game not found");
        Game storage game = games[_gameId];
        return (game.id, game.state, game.playerCount, game.maxPlayers);
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
        bytes32 midnightAddressHash
    ) {
        require(games[_gameId].id != 0, "Game not found");
        require(_playerIndex < games[_gameId].playerCount, "Player index out of bounds");
        Player storage player = games[_gameId].players[_playerIndex];
        return (player.evmAddress, player.midnightAddressHash);
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
