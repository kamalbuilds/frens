// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal views of Perpl's Exchange, field order copied from the official ABI (spike/exchange-official.abi.json).
interface IPerplExchange {
    struct PerpetualInfoV2 {
        string name;
        string symbol;
        uint256 priceDecimals;
        uint256 lotDecimals;
        bytes32 linkFeedId;
        uint256 priceTolPer100K;
        uint256 marginTol;
        uint256 marginTolDecimals;
        uint256 refPriceMaxAgeSec;
        uint256 positionBalanceCNS;
        uint256 insuranceBalanceCNS;
        uint256 markPNS;
        uint256 markTimestamp;
        uint256 lastPNS;
        uint256 lastTimestamp;
        uint256 oraclePNS;
        uint256 oracleTimestampSec;
        uint256 longOpenInterestLNS;
        uint256 shortOpenInterestLNS;
        uint256 fundingStartBlock;
        int16 fundingRatePct100k;
        uint256 absFundingClampPctPer100K;
        uint8 status;
        uint256 basePricePNS;
        uint256 maxBidPriceONS;
        uint256 minBidPriceONS;
        uint256 maxAskPriceONS;
        uint256 minAskPriceONS;
        uint256 numOrders;
        bool ignOracle;
        uint256 fundingSumScalingExp;
    }

    struct OrderV2 {
        uint32 accountId;
        uint8 orderType;
        uint24 priceONS;
        uint40 lotLNS;
        uint16 recycleFeeRaw;
        uint32 expiryBlock;
        uint16 leverageHdths;
        uint16 orderId;
        uint16 prevOrderId;
        uint16 nextOrderId;
        uint16 maxNegPnlCollatBPS;
        uint8 builderId;
        uint16 builderFeePer100K;
    }

    struct PositionBitMap {
        uint256 bank1;
        uint256 bank2;
        uint256 bank3;
        uint256 bank4;
    }

    struct AccountInfo {
        uint256 accountId;
        uint256 balanceCNS;
        uint256 lockedBalanceCNS;
        uint8 frozen;
        address accountAddr;
        PositionBitMap positions;
    }

    function getPerpetualInfoV2(uint256 perpId) external view returns (PerpetualInfoV2 memory);
    function getOrderV2(uint256 perpId, uint256 orderId) external view returns (OrderV2 memory);
    function getAccountByAddr(address accountAddress) external view returns (AccountInfo memory);
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// A position owner backs a friend's take-profit call with a stake. The stake pays the caller only if Perpl's own
/// mark price reaches the call's TP, and returns to the owner at expiry otherwise. The TP, side and owner are read
/// from the resting Perpl order itself, so nobody can stake on a price the order does not carry.
contract CallStake {
    uint8 internal constant CLOSE_LONG = 2;
    uint8 internal constant CLOSE_SHORT = 3;
    /// A stake needs its TP at least this far from Perpl's mark (0.5%), so a payout takes a real price move. Without it
    /// an owner could stake a TP at the mark to their own second wallet and mint "earned" records for free.
    uint256 public constant MIN_DISTANCE_BPS = 50;

    enum State {
        None,
        Open,
        Paid,
        Refunded
    }

    struct Stake {
        address owner;
        address caller;
        uint96 amount;
        uint64 expiry;
        uint32 perpId;
        bool closeLong;
        State state;
        uint256 tpPNS;
    }

    IPerplExchange public immutable exchange;
    IERC20 public immutable token;
    mapping(bytes32 => Stake) public stakes;

    event Staked(bytes32 indexed id, address indexed owner, address indexed caller, uint256 amount, uint256 perpId, uint256 orderId, uint256 tpPNS, bool closeLong, uint64 expiry);
    event Paid(bytes32 indexed id, address indexed caller, uint256 amount, uint256 markPNS);
    event Refunded(bytes32 indexed id, address indexed owner, uint256 amount);

    error StakeExists();
    error NotOpen();
    error NotAClose();
    error NotYourOrder();
    error ZeroAmount();
    error TooCloseToMark(uint256 markPNS, uint256 tpPNS);
    error BadExpiry();
    error NotHit(uint256 markPNS, uint256 tpPNS);
    error NotExpired();
    error Expired();
    error TransferFailed();

    constructor(IPerplExchange exchange_, IERC20 token_) {
        exchange = exchange_;
        token = token_;
    }

    /// Stake on the caller's TP that now rests as `orderId` on `perpId`. `id` is the call's orderDescId (caller in
    /// the top 160 bits), so one call carries at most one stake.
    function stake(bytes32 id, address caller, uint96 amount, uint256 perpId, uint256 orderId, uint64 expiry) external {
        if (stakes[id].state != State.None) revert StakeExists();
        if (amount == 0) revert ZeroAmount();
        if (expiry <= block.timestamp) revert BadExpiry();
        IPerplExchange.OrderV2 memory o = exchange.getOrderV2(perpId, orderId);
        if (o.orderType != CLOSE_LONG && o.orderType != CLOSE_SHORT) revert NotAClose();
        if (o.lotLNS == 0 || exchange.getAccountByAddr(msg.sender).accountId != o.accountId) revert NotYourOrder();
        IPerplExchange.PerpetualInfoV2 memory info = exchange.getPerpetualInfoV2(perpId);
        uint256 tp = uint256(o.priceONS) + info.basePricePNS;
        uint256 gap = (info.markPNS * MIN_DISTANCE_BPS) / 10_000;
        if (o.orderType == CLOSE_LONG ? tp < info.markPNS + gap : tp + gap > info.markPNS) revert TooCloseToMark(info.markPNS, tp);
        stakes[id] = Stake(msg.sender, caller, amount, expiry, uint32(perpId), o.orderType == CLOSE_LONG, State.Open, tp);
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Staked(id, msg.sender, caller, amount, perpId, orderId, tp, o.orderType == CLOSE_LONG, expiry);
    }

    /// Anyone may release once Perpl's mark has reached the TP before expiry: at or above it for a long's TP, at or
    /// below for a short's. After expiry only refund is possible, so the two never race.
    function release(bytes32 id) external {
        Stake storage s = stakes[id];
        if (s.state != State.Open) revert NotOpen();
        if (block.timestamp >= s.expiry) revert Expired();
        uint256 mark = exchange.getPerpetualInfoV2(s.perpId).markPNS;
        if (s.closeLong ? mark < s.tpPNS : mark > s.tpPNS) revert NotHit(mark, s.tpPNS);
        s.state = State.Paid;
        if (!token.transfer(s.caller, s.amount)) revert TransferFailed();
        emit Paid(id, s.caller, s.amount, mark);
    }

    /// Anyone may return an unhit stake to its owner after expiry.
    function refund(bytes32 id) external {
        Stake storage s = stakes[id];
        if (s.state != State.Open) revert NotOpen();
        if (block.timestamp < s.expiry) revert NotExpired();
        s.state = State.Refunded;
        if (!token.transfer(s.owner, s.amount)) revert TransferFailed();
        emit Refunded(id, s.owner, s.amount);
    }
}
