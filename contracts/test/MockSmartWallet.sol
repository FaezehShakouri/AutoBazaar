// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
contract MockSmartWallet {
    address public immutable owner;
    constructor(address owner_) { owner = owner_; }
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        return ECDSA.recover(hash, signature) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
