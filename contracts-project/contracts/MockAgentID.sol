// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockAgentID — TEST-ONLY stand-in for the SPACE ID Agent ID ERC-721.
/// @notice Implements just enough of ERC-721 (balanceOf) for AgentSeal's
///         holder gate. `mint` is permissionless because this contract is
///         only ever used in local tests — it is NEVER deployed to a live
///         network. The real gate target on BNB Smart Chain mainnet is
///         0x60b9262456de011f7d15a54cdd8c48baaa8b022f.
contract MockAgentID {
    mapping(address => uint256) private _balances;
    uint256 public totalMinted;

    function mint(address to) external {
        _balances[to] += 1;
        totalMinted += 1;
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }
}
