// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Minimal interface to the official SPACE ID Agent ID ERC-721.
///      Mainnet (BNB Smart Chain): 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title AgentSeal — escrow + paid-job reputation for hiring AI agents by their Agent ID (.ai name)
/// @notice Hire an agent by its .ai name. Payment stays sealed in escrow until the work
///         checks out, and reputation is built only from settled, paid jobs.
///         "Receipts, not ratings."
///
/// @notice OWNER POWERS — FULL DISCLOSURE (hackathon red-line requirement):
///         The owner can ONLY:
///           1. Pause / unpause NEW profile registrations (`setRegistrationsPaused`).
///           2. Pause / unpause NEW job creation (`setJobCreationPaused`).
///         The owner CANNOT withdraw, move, redirect or otherwise touch escrowed or
///         user funds — this contract deliberately contains NO withdrawal, sweep,
///         rescue or arbitrary-call function, and it does not accept plain BNB
///         transfers (no receive/fallback). Escrowed BNB can only ever leave the
///         contract to (a) the job's provider, on release or after the claim
///         window, or (b) the job's client, on a legitimate cancellation/refund.
///         Pausing never blocks payouts, refunds, deliveries or claims on
///         existing jobs. There is no token, no fee, and no return of any kind
///         is promised to anyone.
contract AgentSeal {
    // ------------------------------------------------------------------
    // Hand-rolled reentrancy guard (zero external dependencies, so that
    // BscScan verification stays a single-file, standard-json affair).
    // ------------------------------------------------------------------
    uint256 private _locked = 1;

    modifier nonReentrant() {
        require(_locked == 1, "AgentSeal: reentrant call");
        _locked = 2;
        _;
        _locked = 1;
    }

    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------
    enum JobState {
        Open,               // created + escrowed, not yet accepted
        Accepted,           // provider accepted, work in progress
        Delivered,          // provider anchored a deliverable hash
        Released,           // client released escrow to provider (settled)
        Refunded,           // cancelled by client, escrow returned (terminal)
        ClaimedAfterWindow  // provider claimed after the 3-day review window (settled)
    }

    struct Profile {
        bool registered;
        string category;
        string metadataURI;
        uint256 foundingNumber; // 1-based sequence: early registrants get low numbers
        uint256 registeredAt;
    }

    struct Job {
        address client;
        address provider;
        uint256 amount;          // escrowed BNB, in wei
        string descriptionURI;
        uint256 deadline;        // unix time; provider must deliver by this time
        uint256 deliveredAt;     // unix time of delivery, 0 until delivered
        bytes32 deliverableHash; // hash of the delivered work, 0 until delivered
        JobState state;
        uint8 rating;            // 0 = unrated, 1..5 after settlement
    }

    struct ProviderStats {
        uint256 jobsSettled;   // released + claimed jobs
        uint256 volumeSettled; // total wei paid out to this provider via settled jobs
        uint256 ratingSum;
        uint256 ratingCount;
        uint256 vouchCount;
    }

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    address public immutable owner;
    IAgentID public immutable agentID;

    /// @notice How long the client has to release (or dispute by simply not
    ///         releasing — funds stay locked) after delivery before the
    ///         provider may claim the escrow themselves.
    uint256 public constant CLAIM_WINDOW = 3 days;

    bool public registrationsPaused;
    bool public jobCreationPaused;

    mapping(address => Profile) private _profiles;
    uint256 public profileCount; // also the last founding number handed out

    mapping(address => mapping(address => bool)) public hasVouched; // provider => voucher => done
    mapping(address => ProviderStats) private _stats;

    Job[] private _jobs;

    // Unique-interactor tracking (the hackathon's 30-address eligibility):
    // an address is counted the first time it passes the Agent ID holder
    // gate and performs a gated action.
    mapping(address => bool) private _hasInteracted;
    uint256 public uniqueInteractorCount;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    event ProfileRegistered(address indexed provider, uint256 foundingNumber, string category, string metadataURI);
    event ProfileUpdated(address indexed provider, string category, string metadataURI);
    event Vouched(address indexed provider, address indexed voucher, uint256 newVouchCount);
    event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, uint256 amount, uint256 deadline, string descriptionURI);
    event JobAccepted(uint256 indexed jobId, address indexed provider);
    event JobDelivered(uint256 indexed jobId, address indexed provider, bytes32 deliverableHash);
    event JobReleased(uint256 indexed jobId, address indexed client, address indexed provider, uint256 amount);
    event JobClaimedAfterWindow(uint256 indexed jobId, address indexed provider, uint256 amount);
    event JobRefunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobRated(uint256 indexed jobId, address indexed client, address indexed provider, uint8 rating);
    event RegistrationsPauseSet(bool paused);
    event JobCreationPauseSet(bool paused);

    // ------------------------------------------------------------------
    // Construction & gates
    // ------------------------------------------------------------------
    /// @param agentIDAddress The SPACE ID Agent ID ERC-721 contract.
    ///        BNB Smart Chain mainnet: 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
    constructor(address agentIDAddress) {
        require(agentIDAddress != address(0), "AgentSeal: zero Agent ID address");
        agentID = IAgentID(agentIDAddress);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "AgentSeal: not owner");
        _;
    }

    /// @dev The Agent ID gate. Enforced on-chain, in the contract — never
    ///      merely in a frontend. Also records first-time interactors.
    modifier onlyHolder() {
        require(agentID.balanceOf(msg.sender) > 0, "AgentSeal: no Agent ID");
        if (!_hasInteracted[msg.sender]) {
            _hasInteracted[msg.sender] = true;
            uniqueInteractorCount += 1;
        }
        _;
    }

    // NOTE: deliberately NO receive() / fallback(). Plain BNB transfers to
    // this contract revert; the only way in is createJob(), and the only
    // ways out are the job settlement/refund paths.

    // ------------------------------------------------------------------
    // Owner controls — pause NEW activity only. See the disclosure at the
    // top of this file: these are the ONLY owner powers that exist.
    // ------------------------------------------------------------------
    function setRegistrationsPaused(bool paused) external onlyOwner {
        registrationsPaused = paused;
        emit RegistrationsPauseSet(paused);
    }

    function setJobCreationPaused(bool paused) external onlyOwner {
        jobCreationPaused = paused;
        emit JobCreationPauseSet(paused);
    }

    // ------------------------------------------------------------------
    // Profiles
    // ------------------------------------------------------------------
    /// @notice Register as a provider. One profile per Agent ID holder address.
    /// @param category Short service category, e.g. "research", "design", "data".
    /// @param metadataURI URI of a JSON profile document (name, skills, rate, endpoint).
    function registerProfile(string calldata category, string calldata metadataURI) external onlyHolder {
        require(!registrationsPaused, "AgentSeal: registrations paused");
        require(!_profiles[msg.sender].registered, "AgentSeal: already registered");
        require(bytes(category).length > 0, "AgentSeal: empty category");
        require(bytes(metadataURI).length > 0, "AgentSeal: empty metadataURI");

        profileCount += 1;
        _profiles[msg.sender] = Profile({
            registered: true,
            category: category,
            metadataURI: metadataURI,
            foundingNumber: profileCount,
            registeredAt: block.timestamp
        });
        emit ProfileRegistered(msg.sender, profileCount, category, metadataURI);
    }

    /// @notice Update your own profile's category / metadata URI.
    function updateProfile(string calldata category, string calldata metadataURI) external onlyHolder {
        require(_profiles[msg.sender].registered, "AgentSeal: not registered");
        require(bytes(category).length > 0, "AgentSeal: empty category");
        require(bytes(metadataURI).length > 0, "AgentSeal: empty metadataURI");
        _profiles[msg.sender].category = category;
        _profiles[msg.sender].metadataURI = metadataURI;
        emit ProfileUpdated(msg.sender, category, metadataURI);
    }

    // ------------------------------------------------------------------
    // Vouching — the low-friction first interaction
    // ------------------------------------------------------------------
    /// @notice Vouch for a registered provider. One vouch per holder per provider.
    function vouch(address provider) external onlyHolder {
        require(provider != msg.sender, "AgentSeal: cannot vouch for yourself");
        require(_profiles[provider].registered, "AgentSeal: provider not registered");
        require(!hasVouched[provider][msg.sender], "AgentSeal: already vouched");
        hasVouched[provider][msg.sender] = true;
        _stats[provider].vouchCount += 1;
        emit Vouched(provider, msg.sender, _stats[provider].vouchCount);
    }

    // ------------------------------------------------------------------
    // Jobs & escrow
    // ------------------------------------------------------------------
    /// @notice Post a job to a registered provider, escrowing the payment in BNB.
    /// @param provider A registered provider (must be an Agent ID holder).
    /// @param descriptionURI URI of the job description document.
    /// @param deadline Unix timestamp by which the provider must deliver.
    /// @return jobId The id of the created job.
    function createJob(address provider, string calldata descriptionURI, uint256 deadline)
        external
        payable
        onlyHolder
        returns (uint256 jobId)
    {
        require(!jobCreationPaused, "AgentSeal: job creation paused");
        require(msg.value > 0, "AgentSeal: zero payment");
        require(provider != msg.sender, "AgentSeal: cannot hire yourself");
        require(_profiles[provider].registered, "AgentSeal: provider not registered");
        require(bytes(descriptionURI).length > 0, "AgentSeal: empty descriptionURI");
        require(deadline > block.timestamp, "AgentSeal: deadline in the past");

        jobId = _jobs.length;
        _jobs.push(Job({
            client: msg.sender,
            provider: provider,
            amount: msg.value,
            descriptionURI: descriptionURI,
            deadline: deadline,
            deliveredAt: 0,
            deliverableHash: bytes32(0),
            state: JobState.Open,
            rating: 0
        }));
        emit JobCreated(jobId, msg.sender, provider, msg.value, deadline, descriptionURI);
    }

    /// @notice Accept a job addressed to you. Only the named provider, only holders.
    function acceptJob(uint256 jobId) external onlyHolder {
        Job storage job = _job(jobId);
        require(msg.sender == job.provider, "AgentSeal: not the provider");
        require(job.state == JobState.Open, "AgentSeal: job not open");
        require(block.timestamp <= job.deadline, "AgentSeal: deadline passed");
        job.state = JobState.Accepted;
        emit JobAccepted(jobId, msg.sender);
    }

    /// @notice Anchor the hash of your delivered work. Only the job's provider.
    function deliverJob(uint256 jobId, bytes32 deliverableHash) external {
        Job storage job = _job(jobId);
        require(msg.sender == job.provider, "AgentSeal: not the provider");
        require(job.state == JobState.Accepted, "AgentSeal: job not accepted");
        require(deliverableHash != bytes32(0), "AgentSeal: empty deliverable hash");
        job.deliverableHash = deliverableHash;
        job.deliveredAt = block.timestamp;
        job.state = JobState.Delivered;
        emit JobDelivered(jobId, msg.sender, deliverableHash);
    }

    /// @notice Release the escrow to the provider after delivery. Only the client.
    function releaseJob(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        require(msg.sender == job.client, "AgentSeal: not the client");
        require(job.state == JobState.Delivered, "AgentSeal: job not delivered");
        uint256 amount = job.amount;
        _settle(job, JobState.Released);
        emit JobReleased(jobId, job.client, job.provider, amount);
    }

    /// @notice Claim the escrow if the client never released within
    ///         CLAIM_WINDOW (3 days) of delivery. Only the job's provider.
    function claimAfterWindow(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        require(msg.sender == job.provider, "AgentSeal: not the provider");
        require(job.state == JobState.Delivered, "AgentSeal: job not delivered");
        require(block.timestamp >= job.deliveredAt + CLAIM_WINDOW, "AgentSeal: window not elapsed");
        uint256 amount = job.amount;
        _settle(job, JobState.ClaimedAfterWindow);
        emit JobClaimedAfterWindow(jobId, job.provider, amount);
    }

    /// @notice Cancel a job and refund the full escrow to the client.
    ///         Allowed (a) any time before the provider accepts, or
    ///         (b) after the deadline if the work was never delivered.
    ///         Only the job's client.
    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        require(msg.sender == job.client, "AgentSeal: not the client");
        bool beforeAcceptance = job.state == JobState.Open;
        bool undeliveredPastDeadline =
            job.state == JobState.Accepted && block.timestamp > job.deadline;
        require(beforeAcceptance || undeliveredPastDeadline, "AgentSeal: cannot cancel now");

        // checks-effects-interactions
        uint256 amount = job.amount;
        job.state = JobState.Refunded;
        job.amount = 0;
        (bool ok, ) = job.client.call{value: amount}("");
        require(ok, "AgentSeal: refund failed");
        emit JobRefunded(jobId, job.client, amount);
    }

    /// @notice Rate a settled job. Only the paying client, only after the
    ///         escrow was released or claimed, exactly once per job.
    ///         Ratings without a paid, settled job are impossible by construction.
    function rateJob(uint256 jobId, uint8 rating) external {
        Job storage job = _job(jobId);
        require(msg.sender == job.client, "AgentSeal: not the client");
        require(
            job.state == JobState.Released || job.state == JobState.ClaimedAfterWindow,
            "AgentSeal: job not settled"
        );
        require(rating >= 1 && rating <= 5, "AgentSeal: rating out of range");
        require(job.rating == 0, "AgentSeal: already rated");
        job.rating = rating;
        _stats[job.provider].ratingSum += rating;
        _stats[job.provider].ratingCount += 1;
        emit JobRated(jobId, job.client, job.provider, rating);
    }

    // ------------------------------------------------------------------
    // Internal settlement — the ONLY code path that pays a provider.
    // ------------------------------------------------------------------
    function _settle(Job storage job, JobState settledState) internal {
        // checks-effects-interactions: state + stats first, payout last.
        uint256 amount = job.amount;
        job.state = settledState;
        job.amount = 0;
        _stats[job.provider].jobsSettled += 1;
        _stats[job.provider].volumeSettled += amount;
        (bool ok, ) = job.provider.call{value: amount}("");
        require(ok, "AgentSeal: payout failed");
    }

    function _job(uint256 jobId) internal view returns (Job storage) {
        require(jobId < _jobs.length, "AgentSeal: no such job");
        return _jobs[jobId];
    }

    // ------------------------------------------------------------------
    // Read helpers
    // ------------------------------------------------------------------
    function getProfile(address account)
        external
        view
        returns (bool registered, string memory category, string memory metadataURI, uint256 foundingNumber, uint256 registeredAt)
    {
        Profile storage p = _profiles[account];
        return (p.registered, p.category, p.metadataURI, p.foundingNumber, p.registeredAt);
    }

    function isRegistered(address account) external view returns (bool) {
        return _profiles[account].registered;
    }

    /// @notice Reputation of a provider, derived only from settled paid jobs + vouches.
    function getProviderStats(address provider)
        external
        view
        returns (uint256 jobsSettled, uint256 volumeSettled, uint256 ratingSum, uint256 ratingCount, uint256 vouchCount)
    {
        ProviderStats storage s = _stats[provider];
        return (s.jobsSettled, s.volumeSettled, s.ratingSum, s.ratingCount, s.vouchCount);
    }

    function getJob(uint256 jobId)
        external
        view
        returns (
            address client,
            address provider,
            uint256 amount,
            string memory descriptionURI,
            uint256 deadline,
            uint256 deliveredAt,
            bytes32 deliverableHash,
            JobState state,
            uint8 rating
        )
    {
        Job storage j = _job(jobId);
        return (j.client, j.provider, j.amount, j.descriptionURI, j.deadline, j.deliveredAt, j.deliverableHash, j.state, j.rating);
    }

    function jobCount() external view returns (uint256) {
        return _jobs.length;
    }

    function hasInteracted(address account) external view returns (bool) {
        return _hasInteracted[account];
    }
}
