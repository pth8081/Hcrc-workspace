// seedChecklistStoreSelfDaily.js — Nội dung mẫu checklist 'Câu hỏi & đáp án' (templateKind QA) TỰ
// ĐÁNH GIÁ HÀNG NGÀY cho GĐST/CHT, trích XUẤT NGUYÊN VẸN từ file Excel người dùng gửi
// ('Copy_of_Form_checklist_daily_G_ST.CHT.xlsx', sheet '10.6' — 'BÁO CÁO CHECKLIST HÀNG NGÀY
// GĐST/CHT') — dùng bởi seedDefaults.js để dựng sẵn 1 template DRAFT ngay lần khởi động đầu tiên
// sau khi triển khai tính năng, cùng khuôn seedVsattpChecklist.js (file TÁCH RIÊNG cho gọn, dữ
// liệu thuần, không logic).
//
// Sheet gốc có 3 cột 'Nội dung'/'Vấn đề cần xử lý'/'Thời gian hoàn thành' — 2 cột sau là cột TRỐNG
// để điền tay khi in giấy, không phải dữ liệu. Hệ thống không có kiểu câu hỏi tự do (chỉ
// SINGLE_CHOICE/MULTIPLE_CHOICE, xem QUESTION_TYPES ở lib/checklist.js) nên mỗi dòng 'Nội dung'
// trở thành 1 câu hỏi SINGLE_CHOICE, 2 lựa chọn 'Đạt'/'Chưa đạt' — chọn 'Chưa đạt' tự kích hoạt
// cơ chế bắt buộc ảnh minh chứng có sẵn của hệ thống (thay cho 2 cột trống ở bản giấy). Mục 12
// 'Thực hiện các công việc khác' ở sheet gốc không có dòng con nào — thêm 1 dòng chung để không
// tạo hạng mục rỗng (không đúng khuôn category ở validateChecklistQuestions()).
'use strict';

const STORE_SELF_DAILY_CHECKLIST_TEMPLATE = {
  templateCode: 'CL_STCH_DAILY',
  templateName: 'Checklist Hàng Ngày GĐST/CHT (Tự Đánh Giá)',
  questions: [
    {
      text: "Hình ảnh (Biển hiệu siêu thị, nguyên vẹn không rách nát, có đủ đèn hắt)",
      category: "1. Kiểm soát cảnh quan chung",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Âm thanh, ánh sáng trong và ngoài siêu thị ( đủ ánh sáng + phát link nhạc CTKM)",
      category: "1. Kiểm soát cảnh quan chung",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Khu vực ngoài sảnh siêu thị: bãi gửi xe, sân, hành lang, vách cửa kính... luôn sạch sẽ, thông thoáng",
      category: "1. Kiểm soát cảnh quan chung",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Bình chữa cháy, bảng tiêu lệnh PCCC và hệ thống camera: hoạt động tốt, để đúng góc quay (cửa ra vào, quầy thu ngân, các quầy hàng giá trị cao, nơi bàn giao tiền với Ngân hàng...) để nơi dễ nhìn, dễ lấy, không bị che chắn bởi hàng hóa hay vật dụng khác",
      category: "1. Kiểm soát cảnh quan chung",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Đầy đủ",
      category: "2. Bảng khuyến mại, tem giá cài kệ",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Đúng vị trí",
      category: "2. Bảng khuyến mại, tem giá cài kệ",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Đúng nguyên tắc bảng thông tin ( check bảng thông tin đặt ngoài cửa ST)",
      category: "2. Bảng khuyến mại, tem giá cài kệ",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Đúng nội dung chương trình khuyến mại (tùy theo từng CTKM)",
      category: "2. Bảng khuyến mại, tem giá cài kệ",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Giá bán sản phẩm trên kệ đúng với giá trên hệ thống",
      category: "2. Bảng khuyến mại, tem giá cài kệ",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Sắp xếp hàng hóa đúng nguyên tắc (đúng layout, đúng vị trí quy định, thuận tiện, dễ thấy, dễ lấy, an toàn, logic về công dụng, không lây mùi, không lây nhiễm..)",
      category: "3. Trưng bày hàng hóa (tùy theo layout từng siêu thị)",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Các line hàng có đầy đủ dây treo bán chéo với nhóm hàng tương quan (1 mặt hàng trên 1 dây treo; 2 element có 1 dây treo; dây treo có tem giá đầy đủ, sp trên dây phải được sắp xếp ngay ngắn)",
      category: "3. Trưng bày hàng hóa (tùy theo layout từng siêu thị)",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Hàng phủ kín mặt, kệ hàng không bị trống, hàng KM có đầy đủ kèm bảng thông tin nhận diện.",
      category: "3. Trưng bày hàng hóa (tùy theo layout từng siêu thị)",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Ngành hàng tươi sống: Thịt, Cá, Rau-Củ-Quả có đầy đủ theo mùa vụ theo đúng quy định về hàng thiết yếu, khu vực bán sản phẩm phải có đầy đủ bao bì cho khách hàng.",
      category: "3. Trưng bày hàng hóa (tùy theo layout từng siêu thị)",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Không xếp hàng hóa quá cao trên kệ, không để hàng hóa trực tiếp dưới mặt đất và không để hàng hóa vướng lối đi. Hàng hóa không để chắn tủ hộp, bình chữa cháy",
      category: "3. Trưng bày hàng hóa (tùy theo layout từng siêu thị)",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Giỏ đựng hàng của khách ngăn nắp, sẵn sàng và sạch sẽ - Được đặt tại vị trí cửa vào của siêu thị. - Không có rác, không có vết cáu bẩn lâu ngày. - Xe troly không hoen rỉ, bánh xe hoạt động tốt",
      category: "4.Vệ sinh",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Đảm bảo trần nhà luôn sạch sẽ không bụi bẩn, sàn siêu thị luôn sạch, khô ráo đặc biệt khu trưng bày thực phẩm tươi sống, khu sơ chế, chế biến.",
      category: "4.Vệ sinh",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Khu vực locker giữ đồ khách hàng sạch sẽ, ngăn nắp. - Tủ bảo quản đầy đủ khóa trong tình trạng tốt. - Không tận dụng để các đồ vật của siêu thị trong khu vực gửi đồ của khách hàng",
      category: "4.Vệ sinh",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Hàng hóa và quầy kệ được lau chùi sạch sẽ, không bụi bẩn, dụng cụ trang thiết bị để đúng nơi quy định (đặc biệt khu tủ rượu và thuốc lá)",
      category: "4.Vệ sinh",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Không để hàng kém chất lượng cùng với hàng đang kinh doanh, hàng lây nhiễm mùi.",
      category: "4.Vệ sinh",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Hàng hóa trong kho (kho lạnh/kho hàng hàng khô) chứa hàng phải được sắp xếp gọn gàng, phải có lối đi vào lấy hàng.",
      category: "5. Kho hàng",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Hàng hóa được đặt trên Pallet, trên giá kệ kho, được phân khu rõ ràng.",
      category: "5. Kho hàng",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Tuân thủ đúng nguyên tắc FIFO trong việc xuất hàng.",
      category: "5. Kho hàng",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Kho chứa hàng sạch sẽ, gọn gàng và đạt nhiệt độ chuẩn: Kho mát: từ 4 - 8oC. Kho đông: từ -22oC đến -15oC",
      category: "5. Kho hàng",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Khu vực nhận hàng thông thoáng, hàng hóa không để trực tiếp trên sàn, lối thoát hiểm không bị cản trở",
      category: "5. Kho hàng",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Hàng hóa đầy đủ nhãn mác, tem phụ, trọng lượng, dung tích, xuất xứ, hạn sử dụng …",
      category: "6. Chất lượng hàng hóa",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Hàng hóa đủ điều kiện bày bán (còn nguyên hình nguyên dạng ban đầu, hạn sử dụng nằm trong phạm vi quy định, rút date đúng thời hạn)",
      category: "6. Chất lượng hàng hóa",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Nhóm hàng fresh (rau, củ, quả) cảm quan đảm bảo tươi, ngon, không dập nát, thối hỏng, đúng quy cách và điều kiện bày bán.",
      category: "6. Chất lượng hàng hóa",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Không có hàng hết data trên quầy",
      category: "6. Chất lượng hàng hóa",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Hàng hóa bảo quản hàng đúng nhiệt độ quy định.",
      category: "6. Chất lượng hàng hóa",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Hàng hỏng, hàng lỗi, hàng chờ xuất trả…để đúng nơi quy định, có bảng biểu nhận biết rõ ràng (Bao gồm cả hàng khô/lạnh)",
      category: "6. Chất lượng hàng hóa",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Lập sổ theo dõi khung nhiệt độ theo giờ đối với tủ BQTP, tủ kem",
      category: "6. Chất lượng hàng hóa",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Tổ chức và thực hiện chương trình khuyến mại, tổ chức sự kiện tại Siêu thị;",
      category: "7.  Phê duyệt và chịu trách nhiệm về đặt hàng, chứng từ liên quan tới hoạt động kinh doanh, xuất/nhập hàng hoá của ST theo phân quyền",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Đề xuất các CTKM push sale",
      category: "7.  Phê duyệt và chịu trách nhiệm về đặt hàng, chứng từ liên quan tới hoạt động kinh doanh, xuất/nhập hàng hoá của ST theo phân quyền",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Đáp ứng đầy đủ, kịp thời, chính xác và phù hợp với nhu cầu kinh doanh của Siêu thị về hàng hóa tại mọi thời điểm;",
      category: "7.  Phê duyệt và chịu trách nhiệm về đặt hàng, chứng từ liên quan tới hoạt động kinh doanh, xuất/nhập hàng hoá của ST theo phân quyền",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Xây dựng cơ cấu hàng hóa, tổ chức kinh doanh Siêu thị phù hợp với chỉ tiêu được giao trong từng thời kỳ",
      category: "7.  Phê duyệt và chịu trách nhiệm về đặt hàng, chứng từ liên quan tới hoạt động kinh doanh, xuất/nhập hàng hoá của ST theo phân quyền",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Tổ chức xuất trả nhà cung cấp các mặt hàng không đủ điều kiện kinh doanh.",
      category: "7.  Phê duyệt và chịu trách nhiệm về đặt hàng, chứng từ liên quan tới hoạt động kinh doanh, xuất/nhập hàng hoá của ST theo phân quyền",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Đánh giá thị hiếu, nhu cầu các mặt hàng, sản phẩm đang kinh doanh, xu hướng thị trường trong từng thời kỳ;",
      category: "7.  Phê duyệt và chịu trách nhiệm về đặt hàng, chứng từ liên quan tới hoạt động kinh doanh, xuất/nhập hàng hoá của ST theo phân quyền",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Chỉ đạo, xử lý các vấn đề phát sinh trong hoạt động kinh doanh Siêu thị theo thẩm quyền được giao;",
      category: "8. Thực hiện vận hành Siêu thị theo đúng các quy trình, quy định của Công ty và phù hợp tình hình kinh doanh của đơn vị:",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Quản lý điều hành toàn bộ nhân sự Siêu thị theo quy định của Công ty và phù hợp tình hình kinh doanh của đơn vị",
      category: "8. Thực hiện vận hành Siêu thị theo đúng các quy trình, quy định của Công ty và phù hợp tình hình kinh doanh của đơn vị:",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Hướng dẫn, đào tạo, kiểm tra giám sát nhân viên thực hiện tuân thủ các quy trình, quy định, và đảm bảo các tiêu chí chất lượng dịch vụ khách hàng theo đúng tiêu chuẩn của Công ty;",
      category: "9. Hướng dẫn, đào tạo nhân viên",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Đánh giá kết quả thực hiện công việc của cán bộ nhân viên và đề xuất khen thưởng, kỷ luật theo quy định của Công ty",
      category: "9. Hướng dẫn, đào tạo nhân viên",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Tìm kiếm và phát triển các nhân viên tiềm năng,có tố chất qua đó xây dựng được lộ trình thăng tiến đối nguồn quản lý kế cận tại Siêu thị.",
      category: "9. Hướng dẫn, đào tạo nhân viên",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Tuyển dụng và có trách nhiệm trong việc giữ nhân viên tại Siêu thị",
      category: "9. Hướng dẫn, đào tạo nhân viên",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Phát hiện và xử lý kịp thời nguy cơ rủi ro thất thoát hàng hóa, An toàn lao động",
      category: "10. Quản lý và chịu trách nhiệm duy trì, bảo toàn giá trị trang thiết bị, giá trị của hàng hóa tại Siêu thị",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Phát hiện và xử lý kịp thời các trường hợp hỏng hóc, thất thoát về tài sản và trang thiết bị hàng hóa theo phân cấp",
      category: "10. Quản lý và chịu trách nhiệm duy trì, bảo toàn giá trị trang thiết bị, giá trị của hàng hóa tại Siêu thị",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Thường xuyên đôn đốc nhắc nhở hoặc trực tiếp kiểm tra hệ thống an toàn PCCC tại Siêu thị để đảm bảo an ninh an toàn PCCC trong Siêu thị.",
      category: "10. Quản lý và chịu trách nhiệm duy trì, bảo toàn giá trị trang thiết bị, giá trị của hàng hóa tại Siêu thị",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Làm việc với các cơ quan quản lý nhà nước thực hiện các thủ tục, quy định liên quan đến hoạt động quản lý Siêu thị;",
      category: "11. Thực hiện các hoạt động đối ngoại",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Chịu trách nhiệm giải quyết mọi khiếu nại, thắc mắc của khách hàng liên quan đến hoạt động Siêu thị.",
      category: "11. Thực hiện các hoạt động đối ngoại",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
    {
      text: "Hoàn thành đầy đủ, đúng quy định các công việc khác phát sinh được giao trong ca trực",
      category: "12. Thực hiện các công việc khác:",
      options: [
        { text: 'Đạt', isPassing: true },
        { text: 'Chưa đạt', isPassing: false }
      ]
    },
  ]
};

module.exports = { STORE_SELF_DAILY_CHECKLIST_TEMPLATE };
