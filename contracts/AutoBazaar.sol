// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Testnet USDC escrow. The game server is the sales/inventory oracle;
/// agents authorize a bounded supplier budget and prices for each individual day.
/// Every balance movement is recorded onchain. Sales move escrow sub-balances;
/// supplier payments, fees, entry deposits and withdrawals move ERC-20 USDC.
contract AutoBazaar is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint64 public constant STAKE = 50_000;
    uint64 public constant CAPITAL = 50_000;
    uint64 public constant DAILY_FEE = 200;
    uint256 public constant UNIT_MICROS = 10; // One game unit = 0.000010 USDC.
    uint256 public constant EXIT_DELAY = 1 days;
    bytes32 public constant JOIN_TYPEHASH = keccak256("Join(uint256 seasonId,bytes32 humanId,uint64 stake,uint64 capital,uint64 deadline)");
    bytes32 public constant DAY_TYPEHASH = keccak256("Day(uint256 seasonId,uint32 day,bytes32 decisionHash,uint64 maxSupplySpend,uint32[6] prices)");

    IERC20 public immutable usdc;
    address public immutable operator;
    address public immutable treasury;
    address[3] public suppliers;
    uint256 public liabilityUnits;

    struct Machine {
        address wallet;
        uint64 cash;
        uint64 arrears;
        uint8 missedFees;
        bool claimed;
        uint32[6] prices;
    }
    struct Season {
        uint64 customerBudget;
        uint64 lastActivity;
        uint32 day;
        uint8 joined;
        bool closed;
        bool aborted;
        uint64 refundPerSeat;
        uint64 refundRemainder;
        Machine[4] machines;
    }
    struct Permit {
        bytes32 decisionHash;
        uint64 maxSupplySpend;
        uint32[6] prices;
        bytes signature;
    }
    struct Order {
        uint8 slot;
        uint8 supplier;
        uint8 product;
        uint16 quantity;
        uint64 amount;
    }
    struct Sale {
        uint8 slot;
        uint8 product;
        uint64 amount;
    }
    mapping(uint256 => Season) private _seasons;
    mapping(uint256 => mapping(bytes32 => bool)) public humanEntered;
    mapping(uint256 => mapping(address => bool)) public walletEntered;
    mapping(uint256 => mapping(uint32 => bytes32)) public dayCommitments;

    event Funded(uint256 indexed seasonId, uint8 indexed slot, address indexed wallet, uint64 customerStake, uint64 operatingCash);
    event DecisionAuthorized(uint256 indexed seasonId, uint32 indexed day, uint8 indexed slot, bytes32 decisionHash, uint64 maxSupplySpend);
    event SupplierPaid(uint256 indexed seasonId, uint32 indexed day, uint8 indexed slot, uint8 supplier, uint8 product, uint16 quantity, uint64 amount);
    event CustomerPurchase(uint256 indexed seasonId, uint32 indexed day, uint32 sequence, uint8 indexed slot, uint8 product, uint64 amount, uint64 budgetAfter);
    event OperatingFee(uint256 indexed seasonId, uint32 indexed day, uint8 indexed slot, uint64 paid, uint64 arrears);
    event DaySettled(uint256 indexed seasonId, uint32 indexed day, bytes32 commitment, uint64 customerBudget, uint64[4] cash, bool closed);
    event SeasonClosed(uint256 indexed seasonId, bool aborted, uint64 customerRefund);
    event Withdrawn(uint256 indexed seasonId, uint8 indexed slot, address indexed wallet, uint64 cash, uint64 customerRefund);

    error Invalid();
    error Unauthorized();
    error Closed();
    error Insufficient();
    error Replayed();

    constructor(IERC20 token, address operator_, address[3] memory suppliers_, address treasury_) EIP712("AutoBazaar", "1") {
        if (block.chainid != 5042002 && block.chainid != 31337) revert Invalid();
        if (block.chainid == 5042002 && address(token) != 0x3600000000000000000000000000000000000000) revert Invalid();
        if (IERC20Metadata(address(token)).decimals() != 6 || operator_ == address(0) || treasury_ == address(0)) revert Invalid();
        for (uint256 i; i < 3; ++i) if (suppliers_[i] == address(0)) revert Invalid();
        usdc = token; operator = operator_; suppliers = suppliers_; treasury = treasury_;
    }
    modifier onlyOperator() { if (msg.sender != operator) revert Unauthorized(); _; }

    function join(uint256 id, address wallet, bytes32 humanId, uint64 deadline, bytes calldata signature) external onlyOperator nonReentrant {
        Season storage s = _seasons[id];
        if (id == 0 || wallet == address(0) || humanId == bytes32(0) || deadline < block.timestamp) revert Invalid();
        if (s.closed || s.joined == 4) revert Closed();
        if (humanEntered[id][humanId] || walletEntered[id][wallet]) revert Replayed();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(JOIN_TYPEHASH, id, humanId, STAKE, CAPITAL, deadline)));
        if (!SignatureChecker.isValidSignatureNow(wallet, digest, signature)) revert Unauthorized();
        uint8 slot = s.joined++;
        s.machines[slot].wallet = wallet; s.machines[slot].cash = CAPITAL;
        s.machines[slot].prices = [uint32(150), 200, 320, 180, 280, 250];
        s.customerBudget += STAKE; s.lastActivity = uint64(block.timestamp);
        humanEntered[id][humanId] = true; walletEntered[id][wallet] = true;
        liabilityUnits += STAKE + CAPITAL;
        usdc.safeTransferFrom(wallet, address(this), uint256(STAKE + CAPITAL) * UNIT_MICROS);
        _solvent();
        emit Funded(id, slot, wallet, STAKE, CAPITAL);
    }

    function settleDay(uint256 id, uint32 day, Permit[4] calldata permits, Order[] calldata orders, Sale[] calldata sales, bytes32 commitment, uint64[4] calldata expectedCash, uint64 expectedBudget) external onlyOperator nonReentrant {
        Season storage s = _seasons[id];
        if (s.closed || s.joined != 4) revert Closed();
        if (day != s.day + 1 || commitment == bytes32(0) || dayCommitments[id][day] != bytes32(0)) revert Replayed();
        if (orders.length > 48 || sales.length > 720) revert Invalid();
        uint64[4] memory spent;
        uint64[3] memory supplierTotals;
        uint8[6][4] memory sold;
        uint16[6] memory baseCosts = [uint16(45), 70, 120, 65, 105, 90];
        uint16[3] memory multipliers = [uint16(115), 100, 82];
        for (uint8 i; i < 4; ++i) {
            Permit calldata p = permits[i];
            if (p.signature.length == 0) {
                if (p.maxSupplySpend != 0 || p.decisionHash != bytes32(0)) revert Unauthorized();
                continue; // A missed decision keeps prices and authorizes no orders.
            }
            if (s.machines[i].missedFees >= 10) revert Closed();
            bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(DAY_TYPEHASH, id, day, p.decisionHash, p.maxSupplySpend, keccak256(abi.encode(p.prices)))));
            if (!SignatureChecker.isValidSignatureNow(s.machines[i].wallet, digest, p.signature)) revert Unauthorized();
            for (uint256 k; k < 6; ++k) if (p.prices[k] < 25 || p.prices[k] > 2000) revert Invalid();
            s.machines[i].prices = p.prices;
            emit DecisionAuthorized(id, day, i, p.decisionHash, p.maxSupplySpend);
        }
        for (uint256 j; j < orders.length; ++j) {
            Order calldata o = orders[j];
            if (o.slot >= 4 || o.supplier >= 3 || o.product >= 6 || o.quantity == 0 || o.quantity > 120 || o.amount == 0) revert Invalid();
            Machine storage m = s.machines[o.slot];
            if (m.missedFees >= 10 || permits[o.slot].signature.length == 0) revert Unauthorized();
            uint256 unitPrice = o.quantity >= 24
                ? (uint256(baseCosts[o.product]) * multipliers[o.supplier] * 92 + 5000) / 10000
                : (uint256(baseCosts[o.product]) * multipliers[o.supplier] + 50) / 100;
            if (o.amount != unitPrice * o.quantity) revert Invalid();
            spent[o.slot] += o.amount;
            if (spent[o.slot] > permits[o.slot].maxSupplySpend || o.amount > m.cash) revert Insufficient();
            m.cash -= o.amount; supplierTotals[o.supplier] += o.amount;
            liabilityUnits -= o.amount;
            emit SupplierPaid(id, day, o.slot, o.supplier, o.product, o.quantity, o.amount);
        }
        for (uint256 j; j < sales.length; ++j) {
            Sale calldata sale = sales[j];
            if (sale.slot >= 4 || sale.product >= 6 || sale.amount == 0) revert Invalid();
            Machine storage m = s.machines[sale.slot];
            if (m.missedFees >= 10) revert Closed();
            if (++sold[sale.slot][sale.product] > 30) revert Invalid();
            uint64 price = uint64(m.prices[sale.product]);
            uint64 due = s.customerBudget < price ? s.customerBudget : price;
            if (sale.amount != due) revert Invalid();
            s.customerBudget -= due; m.cash += due;
            emit CustomerPurchase(id, day, uint32(j + 1), sale.slot, sale.product, due, s.customerBudget);
        }
        uint64 fees;
        uint256 active;
        for (uint8 i; i < 4; ++i) {
            Machine storage m = s.machines[i];
            if (m.missedFees < 10) {
                uint64 due = DAILY_FEE + m.arrears;
                if (m.cash >= due) {
                    m.cash -= due; fees += due; liabilityUnits -= due;
                    m.arrears = 0; m.missedFees = 0;
                    emit OperatingFee(id, day, i, due, 0);
                } else {
                    m.arrears += DAILY_FEE; ++m.missedFees;
                    emit OperatingFee(id, day, i, 0, m.arrears);
                }
                if (m.missedFees < 10) ++active;
            }
            if (m.cash != expectedCash[i]) revert Invalid();
        }
        if (s.customerBudget != expectedBudget) revert Invalid();
        s.day = day; s.lastActivity = uint64(block.timestamp); dayCommitments[id][day] = commitment;
        if (s.customerBudget == 0 || active == 0) _close(id, s, false);
        for (uint8 i; i < 3; ++i) if (supplierTotals[i] != 0) usdc.safeTransfer(suppliers[i], uint256(supplierTotals[i]) * UNIT_MICROS);
        if (fees != 0) usdc.safeTransfer(treasury, uint256(fees) * UNIT_MICROS);
        _solvent();
        emit DaySettled(id, day, commitment, expectedBudget, expectedCash, s.closed);
    }

    /// Anyone can trigger a payout, but the recipient is always the seat wallet.
    /// If the oracle stops, participants can exit after one day without activity.
    function withdraw(uint256 id, uint8 slot) external nonReentrant {
        Season storage s = _seasons[id];
        if (slot >= s.joined) revert Invalid();
        if (!s.closed) {
            if (msg.sender != s.machines[slot].wallet || block.timestamp < s.lastActivity + EXIT_DELAY) revert Unauthorized();
            _close(id, s, true);
        }
        Machine storage m = s.machines[slot];
        if (m.claimed) revert Replayed();
        uint64 cash = m.cash;
        uint64 refund = s.refundPerSeat + (slot == s.joined - 1 ? s.refundRemainder : 0);
        m.cash = 0; m.claimed = true; s.customerBudget -= refund;
        liabilityUnits -= uint256(cash) + refund;
        usdc.safeTransfer(m.wallet, (uint256(cash) + refund) * UNIT_MICROS);
        _solvent();
        emit Withdrawn(id, slot, m.wallet, cash, refund);
    }
    function _close(uint256 id, Season storage s, bool aborted) private {
        s.closed = true; s.aborted = aborted;
        s.refundPerSeat = s.customerBudget / s.joined;
        s.refundRemainder = s.customerBudget % s.joined;
        emit SeasonClosed(id, aborted, s.customerBudget);
    }
    function _solvent() private view { if (usdc.balanceOf(address(this)) < liabilityUnits * UNIT_MICROS) revert Insufficient(); }
    function season(uint256 id) external view returns (uint64 customerBudget, uint32 day, uint8 joined, bool closed, bool aborted, uint64 lastActivity) {
        Season storage s = _seasons[id];
        return (s.customerBudget, s.day, s.joined, s.closed, s.aborted, s.lastActivity);
    }
    function machine(uint256 id, uint8 slot) external view returns (Machine memory) { if (slot >= 4) revert Invalid(); return _seasons[id].machines[slot]; }
}
